// Lead-attribution service — classifies GHL leads by pipeline name into a
// marketing channel (google/facebook) and matches them to Emergent
// (treatment_accepted) conversions by phone/email. Money is integer pence.
import { cockpitRepository } from "../repositories/cockpit.repository.js";

export const normPhone = (s) => (String(s || '').replace(/\D/g, '').slice(-10) || null);
export const normEmail = (s) => (String(s || '').trim().toLowerCase() || null);

// Shared phone-or-email matcher against an accepted-key -> value_pence map
// built by channelBreakdown/matchBreakdown. Exported so other tasks (e.g.
// the cockpit lead list) don't have to duplicate the matching logic.
export function matchAcceptedValue(acceptedByKey, phone, email) {
    if (phone && acceptedByKey.has(phone)) return acceptedByKey.get(phone);
    if (email && acceptedByKey.has(email)) return acceptedByKey.get(email);
    return null;
}

// Builds the accepted-key (normalised phone/email) -> value_pence map from
// raw treatment_accepted rows (first match wins per key). Exported so callers
// that only need per-row matching (e.g. cockpitService.leadsDetail) don't have
// to duplicate this — the single source of truth for the match key set.
export function buildAcceptedByKey(accepted) {
    const acceptedByKey = new Map();
    for (const row of accepted || []) {
        const phone = normPhone(row.phone ?? row.raw?.phone);
        const email = normEmail(row.email ?? row.raw?.email);
        const value = row.value_pence || 0;
        if (phone && !acceptedByKey.has(phone)) acceptedByKey.set(phone, value);
        if (email && !acceptedByKey.has(email)) acceptedByKey.set(email, value);
    }
    return acceptedByKey;
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

    // Accepted key -> value_pence map (first match wins per key).
    const acceptedByKey = buildAcceptedByKey(accepted);

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

        const contact = lead.contacts || {};
        const phone = normPhone(contact.phone);
        const email = normEmail(contact.email);
        const matchedValue = matchAcceptedValue(acceptedByKey, phone, email);

        if (matchedValue !== null) {
            g.conversions += 1;
            g.matchedValuePence += matchedValue;
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

        return { ...result, spendByChannel };
    },
};
