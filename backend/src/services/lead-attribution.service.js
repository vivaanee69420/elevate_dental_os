// Lead-attribution service — classifies GHL leads by pipeline name into a
// marketing channel (google/facebook) and matches them to Emergent
// (treatment_accepted) conversions by phone/email. Money is integer pence.
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

// Pure matcher: pipes = pipelineChannelMap() rows, leads = adLeadsInWindow()
// rows (embedded `contacts`), accepted = acceptedContactsInWindow() rows.
export function matchBreakdown(pipes, leads, accepted) {
    const pipeById = new Map((pipes || []).map((p) => [p.pipeline_id, p]));

    // Accepted key -> rich value map (first match wins per key), plus the
    // practice-scoped name index for the last-resort match.
    const { acceptedByKey, nameByPractice } = buildAcceptedByKey(accepted);

    // Group by practiceId x channel.
    const groups = new Map(); // key `${practiceId}|${channel}` -> stats
    const groupKey = (practiceId, channel) => `${practiceId ?? ''}|${channel}`;

    const annotatedLeads = [];
    for (const lead of leads || []) {
        const pipe = pipeById.get(lead.ghl_pipeline_id);
        const channel = classifyChannel(pipe?.name);
        const practiceId = pipe?.practice_id ?? lead.practice_id ?? null;
        const practiceLabel = pipe?.practice_label ?? null;
        const key = groupKey(practiceId, channel);
        if (!groups.has(key)) {
            groups.set(key, {
                practiceId,
                practiceName: practiceLabel,
                pipelineId: pipe?.pipeline_id ?? null,
                pipelineName: pipe?.name ?? null,
                channel,
                leads: 0,
                conversions: 0,
                matchedValuePence: 0,
            });
        }
        const g = groups.get(key);
        g.leads += 1;

        const matched = matchAcceptedValue({ contacts: lead.contacts, practiceId }, acceptedByKey, nameByPractice);

        if (matched !== null) {
            g.conversions += 1;
            g.matchedValuePence += matched.valuePence;
        }

        annotatedLeads.push({
            ...lead,
            pipelineId: pipe?.pipeline_id ?? null,
            pipelineName: pipe?.name ?? null,
            channel,
        });
    }

    const channels = Array.from(groups.values());

    const group = {
        google: { leads: 0, conversions: 0, matchedValuePence: 0, spendPence: 0 },
        facebook: { leads: 0, conversions: 0, matchedValuePence: 0, spendPence: 0 },
    };
    for (const c of channels) {
        if (c.channel !== 'google' && c.channel !== 'facebook') continue;
        group[c.channel].leads += c.leads;
        group[c.channel].conversions += c.conversions;
        group[c.channel].matchedValuePence += c.matchedValuePence;
    }

    return { channels, group, leads: annotatedLeads };
}

// CPL/ROI live only on groupChannels — ad spend isn't practice-attributable,
// so cost-per-lead (spend/leads) and ROI (matchedValue/spend) are only
// meaningful org-wide. Null-guarded (cpl null when leads=0, roi null when
// spend=0). Money integer pence; roi is a plain ratio (frontend formats ×).
function withCplRoi(group, spendByChannel) {
    const out = {};
    for (const ch of ['google', 'facebook']) {
        const g = group[ch] || { leads: 0, conversions: 0, matchedValuePence: 0 };
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
        const [pipes, leads, accepted, spend] = await Promise.all([
            cockpitRepository.pipelineChannelMap(orgId, practiceId),
            cockpitRepository.adLeadsInWindow(orgId, since, until, practiceId),
            cockpitRepository.acceptedContactsInWindow(orgId, since, until, practiceId),
            cockpitRepository.adSpendByProvider(orgId, since, until),
        ]);

        const result = matchBreakdown(pipes, leads, accepted);

        const spendByChannel = {
            google: spend?.google_ads || 0,
            facebook: spend?.meta_ads || 0,
        };

        result.group.google.spendPence = spendByChannel.google;
        result.group.facebook.spendPence = spendByChannel.facebook;

        // groupChannels is ALWAYS org-wide (ignores practiceId), even when a
        // practice scope was requested — CPL/ROI aren't meaningful per
        // practice since ad spend isn't practice-attributable. Reuse the
        // already-computed org-wide result.group when no practice filter was
        // applied; otherwise re-run the pipe/lead/accepted load unscoped.
        let orgWideGroup = result.group;
        if (practiceId) {
            const [orgPipes, orgLeads, orgAccepted] = await Promise.all([
                cockpitRepository.pipelineChannelMap(orgId, undefined),
                cockpitRepository.adLeadsInWindow(orgId, since, until, undefined),
                cockpitRepository.acceptedContactsInWindow(orgId, since, until, undefined),
            ]);
            orgWideGroup = matchBreakdown(orgPipes, orgLeads, orgAccepted).group;
        }

        const groupChannels = withCplRoi(orgWideGroup, spendByChannel);

        return { ...result, spendByChannel, groupChannels };
    },
};
