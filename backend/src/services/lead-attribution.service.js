// Lead-attribution service — classifies GHL leads by pipeline name into a
// marketing channel (google/facebook) and matches them to Emergent
// (treatment_accepted) conversions by phone/email/name. Money is integer pence.
import { cockpitRepository } from "../repositories/cockpit.repository.js";

export const normPhone = (s) => (String(s || '').replace(/\D/g, '').slice(-10) || null);
export const normEmail = (s) => (String(s || '').trim().toLowerCase() || null);

// Normalises a name for matching: lowercase, trimmed, internal whitespace
// collapsed to a single space. Two forms: normName(first, last) or
// normName(fullName) (single arg). Returns null for an empty/blank result —
// callers must never index a Map with '' or a matched-everything key.
export function normName(a, b) {
    const full = arguments.length >= 2 ? `${a || ''} ${b || ''}` : String(a || '');
    const collapsed = full.trim().toLowerCase().replace(/\s+/g, ' ');
    return collapsed || null;
}

// Shared phone -> email -> (practice-scoped) name matcher. `lead` is a small
// shape { contacts: {phone,email,first_name,last_name}, practiceId } — call
// sites build this from whatever row shape they have (leads table row or the
// matchBreakdown per-lead loop). Phone/email match cross-practice (a patient
// might convert at a different practice); name match is scoped to the lead's
// practice via nameByPractice to cut false positives on common names.
// Returns the matched rich accepted value { valuePence, treatmentName,
// patientName, acceptedDate } or null.
export function matchAcceptedValue(lead, acceptedByKey, nameByPractice) {
    const contact = lead?.contacts || {};
    const phone = normPhone(contact.phone);
    const email = normEmail(contact.email);
    if (phone && acceptedByKey.has(phone)) return acceptedByKey.get(phone);
    if (email && acceptedByKey.has(email)) return acceptedByKey.get(email);
    const nm = normName(contact.first_name, contact.last_name);
    if (nm) {
        const nameMap = nameByPractice?.get(lead?.practiceId ?? null);
        if (nameMap && nameMap.has(nm)) return nameMap.get(nm);
    }
    return null;
}

// Builds the accepted-key (normalised phone/email) -> rich value map from raw
// treatment_accepted rows (first match wins per key), PLUS a practice-scoped
// name index (nameByPractice: Map<practiceId, Map<normName, value>>) used as
// the last-resort match. Exported so callers that only need per-row matching
// (e.g. cockpitService.leadsDetail) don't have to duplicate this — the single
// source of truth for the match key set. Value shape: { valuePence,
// treatmentName, patientName, acceptedDate }.
export function buildAcceptedByKey(accepted) {
    const acceptedByKey = new Map();
    const nameByPractice = new Map();
    for (const row of accepted || []) {
        const phone = normPhone(row.phone ?? row.raw?.phone);
        const email = normEmail(row.email ?? row.raw?.email);
        const value = {
            valuePence: row.value_pence || 0,
            treatmentName: row.treatment_name ?? null,
            patientName: row.patient_name ?? null,
            acceptedDate: row.accepted_date ?? null,
        };
        if (phone && !acceptedByKey.has(phone)) acceptedByKey.set(phone, value);
        if (email && !acceptedByKey.has(email)) acceptedByKey.set(email, value);

        const nm = normName(row.patient_name);
        if (nm) {
            const practiceKey = row.practice_id ?? null;
            if (!nameByPractice.has(practiceKey)) nameByPractice.set(practiceKey, new Map());
            const nameMap = nameByPractice.get(practiceKey);
            if (!nameMap.has(nm)) nameMap.set(nm, value);
        }
    }
    return { acceptedByKey, nameByPractice };
}

// Pipeline name -> channel. Checked in this order: facebook, google,
// instagram, website, else 'other' (the catch-all — never null).
export function classifyChannel(pipelineName) {
    const name = String(pipelineName || '');
    if (/facebook|\bfb\b/i.test(name)) return 'facebook';
    if (/google/i.test(name)) return 'google';
    if (/instagram|\big\b/i.test(name)) return 'instagram';
    if (/website|web|organic/i.test(name)) return 'website';
    return 'other';
}

// One person can sit in several pipelines of the same channel (re-enquiries,
// an opportunity per campaign), and each is its own `leads` row. Counting rows
// would report more Google/Facebook leads than there are people. Everything
// below counts PEOPLE, keyed on the contact — falling back to the lead's own
// id only when a lead somehow has no contact.
const personKey = (lead) => lead.contact_id ?? `lead:${lead.id}`;

const AD_CHANNELS = ['google', 'facebook'];
const emptyStats = () => ({ leads: 0, conversions: 0, matchedValuePence: 0, entries: 0 });

// Pure matcher: pipes = pipelineChannelMap() rows, leads = adLeadsInWindow()
// rows (embedded `contacts`), accepted = acceptedForMatching() rows.
//
// Leads whose GHL subaccount has no practice mapping are NOT folded into any
// practice's numbers — those subaccounts aren't dental patient feeds (an org
// can also connect an academy/accounting location). They go to `unmapped`, so
// they are reported rather than silently counted or silently dropped.
export function matchBreakdown(pipes, leads, accepted) {
    const pipeById = new Map((pipes || []).map((p) => [p.pipeline_id, p]));
    const { acceptedByKey, nameByPractice } = buildAcceptedByKey(accepted);

    const groups = new Map();     // `${practiceId}|${channel}` -> stats
    const seen = new Map();       // same key -> Set(personKey), the dedupe
    const unmapped = new Map();   // accountId -> { accountId, label, leads, people:Set }
    const annotatedLeads = [];

    for (const lead of leads || []) {
        const pipe = pipeById.get(lead.ghl_pipeline_id);
        const channel = classifyChannel(pipe?.name);
        const practiceId = pipe?.practice_id ?? lead.practice_id ?? null;
        const person = personKey(lead);

        annotatedLeads.push({
            ...lead,
            pipelineId: pipe?.pipeline_id ?? null,
            pipelineName: pipe?.name ?? null,
            channel,
        });

        // No practice behind this subaccount -> not a practice's lead.
        if (practiceId === null) {
            if (!AD_CHANNELS.includes(channel)) continue;
            const accountId = pipe?.account_id ?? null;
            if (!unmapped.has(accountId)) {
                unmapped.set(accountId, {
                    accountId,
                    label: pipe?.account_label ?? 'Unknown subaccount',
                    leads: 0,
                    people: new Set(),
                });
            }
            unmapped.get(accountId).people.add(person);
            continue;
        }

        const key = `${practiceId}|${channel}`;
        if (!groups.has(key)) {
            groups.set(key, {
                practiceId,
                practiceName: pipe?.practice_label ?? null,
                pipelineId: pipe?.pipeline_id ?? null,
                pipelineName: pipe?.name ?? null,
                channel,
                ...emptyStats(),
            });
            seen.set(key, new Set());
        }
        const g = groups.get(key);
        g.entries += 1;                    // raw opportunity rows, for the UI's "N entries" note

        const people = seen.get(key);
        if (people.has(person)) continue;  // already counted this person in this channel
        people.add(person);
        g.leads += 1;

        const matched = matchAcceptedValue({ contacts: lead.contacts, practiceId }, acceptedByKey, nameByPractice);
        if (matched !== null) {
            g.conversions += 1;
            g.matchedValuePence += matched.valuePence;
        }
    }

    const channels = Array.from(groups.values());

    return {
        channels,
        group: sumChannels(channels),
        unmapped: {
            leads: Array.from(unmapped.values()).reduce((n, a) => n + a.people.size, 0),
            accounts: Array.from(unmapped.values())
                .map((a) => ({ accountId: a.accountId, label: a.label, leads: a.people.size }))
                .sort((a, b) => b.leads - a.leads),
        },
        leads: annotatedLeads,
    };
}

// Rolls a set of per-practice channel rows up into google/facebook totals.
// Used for both the org-wide group figure and the practice-scoped one — same
// arithmetic, different row set, so the two can never disagree.
export function sumChannels(channels) {
    const out = { google: { ...emptyStats(), spendPence: 0 }, facebook: { ...emptyStats(), spendPence: 0 } };
    for (const c of channels || []) {
        if (!AD_CHANNELS.includes(c.channel)) continue;
        out[c.channel].leads += c.leads;
        out[c.channel].conversions += c.conversions;
        out[c.channel].matchedValuePence += c.matchedValuePence;
        out[c.channel].entries += c.entries;
    }
    return out;
}

// CPL/ROI live only on groupChannels — ad spend isn't practice-attributable
// (ad_metrics.practice_id is null for every live account), so cost-per-lead
// (spend/leads) and ROI (matchedValue/spend) are only meaningful org-wide.
// Null-guarded (cpl null when leads=0, roi null when spend=0). Money integer
// pence; roi is a plain ratio (frontend formats ×).
function withCplRoi(group, spendByChannel) {
    const out = {};
    for (const ch of AD_CHANNELS) {
        const g = group[ch] || emptyStats();
        const spendPence = spendByChannel[ch] || 0;
        out[ch] = {
            leads: g.leads,
            conversions: g.conversions,
            matchedValuePence: g.matchedValuePence,
            spendPence,
            cplPence: g.leads ? Math.round(spendPence / g.leads) : null,
            roi: spendPence ? g.matchedValuePence / spendPence : null,
        };
    }
    return out;
}

export const leadAttributionService = {
    async channelBreakdown(orgId, { since, until, practiceId } = {}) {
        // Loaded org-wide, ALWAYS. The practice filter selects which rows the
        // page shows; it must not change how a lead is matched, and it must
        // not change the group total the scoped figure is compared against.
        // (Previously the scoped and org-wide views ran two separate loads,
        // which is how a practice with no GHL subaccount ended up showing 0
        // leads next to a group total of 62.)
        const [pipes, leads, accepted, spend] = await Promise.all([
            cockpitRepository.pipelineChannelMap(orgId),
            cockpitRepository.adLeadsInWindow(orgId, since, until),
            cockpitRepository.acceptedForMatching(orgId, since),
            cockpitRepository.adSpendByProvider(orgId, since, until),
        ]);

        const all = matchBreakdown(pipes, leads, accepted);

        const spendByChannel = {
            google: spend?.google_ads || 0,
            facebook: spend?.meta_ads || 0,
        };
        all.group.google.spendPence = spendByChannel.google;
        all.group.facebook.spendPence = spendByChannel.facebook;

        const channels = practiceId ? all.channels.filter((c) => c.practiceId === practiceId) : all.channels;
        const scoped = practiceId ? sumChannels(channels) : null;

        return {
            channels,
            group: all.group,
            scoped,
            unmapped: all.unmapped,
            spendByChannel,
            groupChannels: withCplRoi(all.group, spendByChannel),
        };
    },
};
