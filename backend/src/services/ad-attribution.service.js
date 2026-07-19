// ============================================================================
// Ad attribution service — Google vs Facebook performance from an EXPLICIT
// pipeline -> channel map, joined to Emergent accepted treatments.
//
// Channel comes only from ad_channel_pipelines. There is no name-based
// inference here; a pipeline with no mapping is 'unassigned' and is reported
// as its own bucket rather than guessed at or hidden.
//
// Practice comes from the GHL subaccount. A subaccount with practice_id null
// is not a dental practice feed (the academy and accounting Locations live
// there too) and its leads are excluded, counted only as excludedUnmappedLeads.
//
// Money is integer pence.
// ============================================================================
import { adChannelPipelineRepository } from "../repositories/ad-channel-pipeline.repository.js";
import { adAttributionRepository } from "../repositories/ad-attribution.repository.js";
import { integrationAccountRepository } from "../repositories/integration-account.repository.js";
import { buildAcceptedByKey, matchAcceptedValue } from "../lib/lead-emergent-match.js";

export const CHANNELS = ['google_ads', 'meta_ads', 'unassigned'];
const AD_CHANNELS = ['google_ads', 'meta_ads'];

// Pipeline ids are unique only within a GHL Location.
const pipeKey = (accountId, pipelineId) => `${accountId}|${pipelineId}`;

export function resolveChannel(channelMap, accountId, pipelineId) {
    return channelMap.get(pipeKey(accountId, pipelineId)) ?? 'unassigned';
}

// One row per PERSON. Counting opportunity rows inflates the lead count when
// somebody sits in two pipelines.
export const personKey = (lead) => lead.contact_id ?? `lead:${lead.id}`;

// Null, never 0 and never Infinity: a zero-denominator cost per lead is
// unknown, and rendering it as 0 reads as "free leads".
export function ratio(numerator, denominator) {
    if (!denominator) return null;
    return numerator / denominator;
}

const emptyStats = (channel) => ({
    channel, leads: 0, conversions: 0, acceptedValuePence: 0, spendPence: 0, _hasSpend: false,
});

function finalise(stats, { allowSpend }) {
    // 'unassigned' has no spend feed at all; its spend and derived costs are
    // unknown rather than zero.
    const spendPence = allowSpend && stats._hasSpend ? stats.spendPence : null;
    return {
        channel: stats.channel,
        leads: stats.leads,
        conversions: stats.conversions,
        acceptedValuePence: stats.acceptedValuePence,
        spendPence,
        costPerLeadPence: spendPence === null ? null : ratio(spendPence, stats.leads),
        costPerAcquisitionPence: spendPence === null ? null : ratio(spendPence, stats.conversions),
        conversionRate: ratio(stats.conversions, stats.leads),
    };
}

export function computePerformance({ leads, accepted, spend, channelMap, accountPractice }) {
    const { acceptedByKey, nameByPractice } = buildAcceptedByKey(accepted);

    const group = new Map(CHANNELS.map((c) => [c, emptyStats(c)]));
    const byPractice = new Map();      // practiceId -> Map<channel, stats>
    const seenGroup = new Map(CHANNELS.map((c) => [c, new Set()]));
    const seenPractice = new Map();    // `${practiceId}|${channel}` -> Set(personKey)
    let excludedUnmappedLeads = 0;

    const practiceStats = (practiceId, channel) => {
        if (!byPractice.has(practiceId)) {
            byPractice.set(practiceId, new Map(CHANNELS.map((c) => [c, emptyStats(c)])));
        }
        return byPractice.get(practiceId).get(channel);
    };

    for (const lead of leads || []) {
        const accountId = lead.integration_account_id;
        const practiceId = accountPractice.get(accountId) ?? null;
        if (practiceId === null) { excludedUnmappedLeads += 1; continue; }

        const channel = resolveChannel(channelMap, accountId, lead.ghl_pipeline_id);
        const person = personKey(lead);

        const groupSeen = seenGroup.get(channel);
        const pKey = `${practiceId}|${channel}`;
        if (!seenPractice.has(pKey)) seenPractice.set(pKey, new Set());
        const practiceSeen = seenPractice.get(pKey);

        const isNewToGroup = !groupSeen.has(person);
        const isNewToPractice = !practiceSeen.has(person);
        if (!isNewToGroup && !isNewToPractice) continue;
        groupSeen.add(person);
        practiceSeen.add(person);

        const matched = matchAcceptedValue(
            { contacts: lead.contacts, practiceId }, acceptedByKey, nameByPractice,
        );

        if (isNewToGroup) {
            const g = group.get(channel);
            g.leads += 1;
            if (matched) { g.conversions += 1; g.acceptedValuePence += matched.valuePence; }
        }
        if (isNewToPractice) {
            const p = practiceStats(practiceId, channel);
            p.leads += 1;
            if (matched) { p.conversions += 1; p.acceptedValuePence += matched.valuePence; }
        }
    }

    for (const row of spend || []) {
        if (!AD_CHANNELS.includes(row.provider)) continue;
        const g = group.get(row.provider);
        g.spendPence += row.spend_pence || 0;
        g._hasSpend = true;
        // Only spend on an ad account that has been mapped to a practice can be
        // attributed below group level.
        if (row.practice_id) {
            const p = practiceStats(row.practice_id, row.provider);
            p.spendPence += row.spend_pence || 0;
            p._hasSpend = true;
        }
    }

    return {
        channels: CHANNELS.map((c) => finalise(group.get(c), { allowSpend: c !== 'unassigned' })),
        byPractice: [...byPractice.entries()].map(([practiceId, chans]) => ({
            practiceId,
            channels: CHANNELS.map((c) => finalise(chans.get(c), { allowSpend: c !== 'unassigned' })),
        })),
        excludedUnmappedLeads,
    };
}

export const adAttributionService = {
    // Everything the settings screen needs, in one round trip.
    async getConfig(orgId) {
        const [accounts, practices, adAccounts, channelMap, leadCounts] = await Promise.all([
            adAttributionRepository.ghlAccounts(orgId),
            adAttributionRepository.practiceOptions(orgId),
            adAttributionRepository.adAccounts(orgId),
            adChannelPipelineRepository.channelMap(orgId),
            adAttributionRepository.leadCountsByPipeline(orgId),
        ]);
        const practiceName = new Map(practices.map((p) => [p.id, p.name]));
        return {
            practices,
            subaccounts: accounts.map((a) => ({
                id: a.id,
                label: a.label,
                locationId: a.external_account_id,
                status: a.status,
                practiceId: a.practice_id,
                practiceName: a.practice_id ? practiceName.get(a.practice_id) ?? null : null,
                pipelineCount: a.pipelines.length,
                leadCount: a.pipelines.reduce(
                    (n, p) => n + (leadCounts.get(pipeKey(a.id, p.id)) ?? 0), 0),
            })),
            pipelines: accounts.flatMap((a) => a.pipelines.map((p) => ({
                accountId: a.id,
                accountLabel: a.label,
                practiceId: a.practice_id,
                practiceName: a.practice_id ? practiceName.get(a.practice_id) ?? null : null,
                pipelineId: p.id,
                pipelineName: p.name,
                channel: channelMap.get(pipeKey(a.id, p.id)) ?? null,
                leadCount: leadCounts.get(pipeKey(a.id, p.id)) ?? 0,
            }))),
            adAccounts: adAccounts.map((a) => ({
                id: a.id,
                provider: a.provider,
                customerId: a.customer_id,
                name: a.name,
                practiceId: a.practice_id ?? null,
                practiceName: a.practice_id ? practiceName.get(a.practice_id) ?? null : null,
            })),
        };
    },

    async setPipelineChannel(orgId, accountId, pipelineId, channel) {
        const accounts = await adAttributionRepository.ghlAccounts(orgId);
        const account = accounts.find((a) => a.id === accountId);
        // Rejecting an unknown account is the tenant guard on this write: the
        // account list is already org-scoped.
        if (!account) throw new Error('Unknown subaccount');
        const pipeline = account.pipelines.find((p) => String(p.id) === String(pipelineId));
        await adChannelPipelineRepository.setChannel(
            orgId, accountId, pipelineId, pipeline?.name ?? null, channel,
        );
        return { ok: true };
    },

    async setSubaccountPractice(orgId, accountId, practiceId) {
        // Delegates to the existing GHL account update path rather than writing
        // integration_accounts directly, so the one-subaccount-per-practice
        // unique index and any provider-side validation stay in one place.
        await integrationAccountRepository.update(orgId, accountId, { practice_id: practiceId ?? null });
        return { ok: true };
    },

    async setAdAccountPractice(orgId, adAccountId, practiceId) {
        await adAttributionRepository.setAdAccountPractice(orgId, adAccountId, practiceId);
        return { ok: true };
    },

    async getPerformance(orgId, { since, until, practiceId }) {
        const [channelMap, accounts, leads, accepted, spend] = await Promise.all([
            adChannelPipelineRepository.channelMap(orgId),
            adAttributionRepository.ghlAccounts(orgId),
            adAttributionRepository.leadsInWindow(orgId, since, until),
            adAttributionRepository.acceptedForMatching(orgId, since, until),
            adAttributionRepository.adSpend(orgId, since, until),
        ]);
        const accountPractice = new Map(accounts.map((a) => [a.id, a.practice_id]));
        const practiceName = new Map(
            (await adAttributionRepository.practiceOptions(orgId)).map((p) => [p.id, p.name]),
        );
        const result = computePerformance({ leads, accepted, spend, channelMap, accountPractice });
        const byPractice = result.byPractice
            .filter((p) => !practiceId || p.practiceId === practiceId)
            .map((p) => ({ ...p, practiceName: practiceName.get(p.practiceId) ?? null }));
        return {
            channels: practiceId
                ? (byPractice[0]?.channels ?? CHANNELS.map((c) => finalise(emptyStats(c), { allowSpend: c !== 'unassigned' })))
                : result.channels,
            byPractice,
            excludedUnmappedLeads: result.excludedUnmappedLeads,
            unmappedPipelineCount: [...channelMap.keys()].length === 0
                ? accounts.reduce((n, a) => n + a.pipelines.length, 0)
                : accounts.reduce((n, a) => n + a.pipelines.filter(
                    (p) => !channelMap.has(pipeKey(a.id, p.id))).length, 0),
        };
    },
};
