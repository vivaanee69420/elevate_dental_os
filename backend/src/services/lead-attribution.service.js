// Lead-attribution service — classifies GHL leads by pipeline name into a
// marketing channel (google/facebook) and matches them to Emergent
// (treatment_accepted) conversions by phone/email. Money is integer pence.
import { cockpitRepository } from "../repositories/cockpit.repository.js";

const normPhone = (s) => (String(s || '').replace(/\D/g, '').slice(-10) || null);
const normEmail = (s) => (String(s || '').trim().toLowerCase() || null);

// Pipeline name -> channel. facebook checked first since some pipeline names
// could plausibly mention both; only google/facebook are supported channels.
export function classifyChannel(pipelineName) {
    const name = String(pipelineName || '');
    if (/facebook|\bfb\b/i.test(name)) return 'facebook';
    if (/google/i.test(name)) return 'google';
    return null;
}

// Pure matcher: pipes = pipelineChannelMap() rows, leads = adLeadsInWindow()
// rows (embedded `contacts`), accepted = acceptedContactsInWindow() rows.
export function matchBreakdown(pipes, leads, accepted) {
    const pipeById = new Map((pipes || []).map((p) => [p.pipeline_id, p]));

    // Build accepted key -> value_pence map (first match wins per key).
    const acceptedByKey = new Map();
    for (const row of accepted || []) {
        const phone = normPhone(row.phone ?? row.raw?.phone);
        const email = normEmail(row.email ?? row.raw?.email);
        const value = row.value_pence || 0;
        if (phone && !acceptedByKey.has(phone)) acceptedByKey.set(phone, value);
        if (email && !acceptedByKey.has(email)) acceptedByKey.set(email, value);
    }

    // Group by practiceId x channel.
    const groups = new Map(); // key `${practiceId}|${channel}` -> stats
    const groupKey = (practiceId, channel) => `${practiceId ?? ''}|${channel}`;

    for (const lead of leads || []) {
        const pipe = pipeById.get(lead.ghl_pipeline_id);
        const channel = classifyChannel(pipe?.name);
        if (!channel) continue;
        const practiceId = pipe?.practice_id ?? lead.practice_id ?? null;
        const practiceLabel = pipe?.practice_label ?? null;
        const key = groupKey(practiceId, channel);
        if (!groups.has(key)) {
            groups.set(key, {
                practiceId,
                practiceName: practiceLabel,
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
        let matchedValue = null;
        if (phone && acceptedByKey.has(phone)) matchedValue = acceptedByKey.get(phone);
        else if (email && acceptedByKey.has(email)) matchedValue = acceptedByKey.get(email);

        if (matchedValue !== null) {
            g.conversions += 1;
            g.matchedValuePence += matchedValue;
        }
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

    return { channels, group };
}

export const leadAttributionService = {
    async channelBreakdown(orgId, { since, until } = {}) {
        const [pipes, leads, accepted, spend] = await Promise.all([
            cockpitRepository.pipelineChannelMap(orgId),
            cockpitRepository.adLeadsInWindow(orgId, since, until),
            cockpitRepository.acceptedContactsInWindow(orgId, since, until),
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
