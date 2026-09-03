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
import { adGrainRepository } from "../repositories/ad-grain.repository.js";
import { buildAcceptedByKey, matchAcceptedValue } from "../lib/lead-emergent-match.js";
import { AppError } from "../middleware/errors.js";

export const CHANNELS = ['google_ads', 'meta_ads', 'unassigned'];
const AD_CHANNELS = ['google_ads', 'meta_ads'];

// An ad feed that has not delivered a row in this many days is reported stale.
// Both connectors sync nightly, so a week's silence is well beyond normal
// jitter (a weekend gap plus a retry is at most ~3 days).
export const FEED_STALE_AFTER_DAYS = 7;

// Pipeline ids are unique only within a GHL Location.
const pipeKey = (accountId, pipelineId) => `${accountId}|${pipelineId}`;

// 'YYYY-MM' from an ISO timestamp or a YYYY-MM-DD date string.
const monthKey = (value) => String(value ?? '').slice(0, 7);

export function resolveChannel(channelMap, accountId, pipelineId) {
    return channelMap.get(pipeKey(accountId, pipelineId)) ?? 'unassigned';
}

// One row per PERSON. Counting opportunity rows inflates the lead count when
// somebody sits in two pipelines.
export const personKey = (lead) => lead.contact_id ?? `lead:${lead.id}`;

// The ad_accounts.practice_id mapping, keyed for lookup from a spend row.
//
// Since migration 000140 ad_metrics.practice_id carries a stamped copy of this
// same mapping, so this join is no longer the only way to reach it. It is kept
// as the resolver for THIS service because it computes the mapped/unmapped
// split for the attribution screen and needs the account dimension anyway —
// and because resolving live means an account remapped seconds ago is already
// reflected here, independent of the restamp.
//
// Keyed on provider AND customer_id: ad_accounts is unique on
// (organisation_id, provider, customer_id), so a bare customer id could
// collide across providers.
export function accountPracticeByCustomerId(adAccounts) {
    const map = new Map();
    for (const a of adAccounts ?? []) {
        map.set(`${a.provider}|${a.customer_id}`, a.practice_id ?? null);
    }
    return map;
}

// Null, never 0 and never Infinity: a zero-denominator cost per lead is
// unknown, and rendering it as 0 reads as "free leads".
export function ratio(numerator, denominator) {
    if (!denominator) return null;
    return numerator / denominator;
}

const emptyStats = (channel) => ({
    channel, leads: 0, conversions: 0, acceptedValuePence: 0, spendPence: 0,
});

// Round a ratio to whole pence at the boundary — costPerLeadPence /
// costPerAcquisitionPence are money and must not carry fractional pence.
const roundPence = (value) => (value === null ? null : Math.round(value));

// `costLeadsDenom`/`costConversionsDenom` let a caller (the totals adapter,
// below) divide the cost metrics by a different — narrower — population than
// `leads`/`conversions` without duplicating the ratio/rounding logic here.
// `forceCostNull` covers the incomplete-spend guard: a known spend total that
// is nonetheless not safe to divide (see totalsFromStats).
function finalise(stats, {
    allowSpend, costLeadsDenom, costConversionsDenom, forceCostNull = false,
} = {}) {
    // 'unassigned' has no spend feed at all; its spend and derived costs are
    // unknown rather than zero. And ad_metrics.spend_pence defaults to 0 for a
    // synced day with genuinely no spend, so a zero ACCUMULATED total is just
    // as "unknown" as no rows at all — a real feed with £0 spend still reads
    // as "Not reporting", never a fabricated £0.
    //
    // `!== 0` rather than `> 0`: spend_pence is a signed BIGINT, so a
    // net-negative window (credits/adjustments) is real, known spend and must
    // not be flattened into "Not reporting" just because it isn't positive.
    // Zero is the only value that means "no feed".
    const spendPence = allowSpend && stats.spendPence !== 0 ? stats.spendPence : null;
    const costUnknown = forceCostNull || spendPence === null;
    const leadsDenom = costLeadsDenom ?? stats.leads;
    const conversionsDenom = costConversionsDenom ?? stats.conversions;
    return {
        channel: stats.channel,
        leads: stats.leads,
        conversions: stats.conversions,
        acceptedValuePence: stats.acceptedValuePence,
        spendPence,
        costPerLeadPence: costUnknown ? null : roundPence(ratio(spendPence, leadsDenom)),
        costPerAcquisitionPence: costUnknown ? null : roundPence(ratio(spendPence, conversionsDenom)),
        conversionRate: ratio(stats.conversions, stats.leads),
    };
}

// finalise() expects per-channel stats; a "total" isn't a channel but has the
// same shape, so it goes through the same derivation rather than a second
// copy of the ratio logic. The one place a total genuinely differs from a
// channel: cost metrics must divide paid spend by PAID leads/conversions
// (google_ads + meta_ads, deduped), never by `leads`/`conversions` — those
// are deduped across ALL channels including unassigned, which has no spend
// feed. Dividing known spend by that inflated denominator is the Critical
// defect this adapter exists to close.
//
// `conversionRate` deliberately still uses the all-channel leads/conversions
// via `finalise()`'s default — it is a funnel rate over everyone attracted,
// not a paid-media efficiency metric, so its denominator differs on purpose
// from the cost metrics next to it.
function totalsFromStats({
    leads, conversions, acceptedValuePence, paidLeads, paidConversions, spendPence, incompleteSpend,
}) {
    const base = finalise(
        {
            channel: 'total', leads, conversions, acceptedValuePence, spendPence,
        },
        {
            allowSpend: true,
            costLeadsDenom: paidLeads,
            costConversionsDenom: paidConversions,
            forceCostNull: incompleteSpend,
        },
    );
    // Exposed so the arithmetic reconciles visibly on screen: spendPence /
    // paidLeads should visibly equal costPerLeadPence, not look like a typo.
    return { ...base, paidLeads, paidConversions };
}

export function computePerformance({
    leads, accepted, spend, channelMap, accountPractice, adAccountPractice = new Map(),
}) {
    const { acceptedByKey, nameByPractice } = buildAcceptedByKey(accepted);

    const group = new Map(CHANNELS.map((c) => [c, emptyStats(c)]));
    const byPractice = new Map();      // practiceId -> Map<channel, stats>
    const seenGroup = new Map(CHANNELS.map((c) => [c, new Set()]));
    const seenPractice = new Map();    // `${practiceId}|${channel}` -> Set(personKey)
    let excludedUnmappedLeads = 0;

    // Deduped-across-channel totals: keyed on personKey ALONE (no channel), so
    // a person tagged under two channels (or one mapped + one unassigned
    // pipeline) is counted once here even though the per-channel rows above
    // still count them once per channel by design.
    const seenGroupTotal = new Set();
    const seenPracticeTotal = new Map(); // practiceId -> Set(personKey)
    const groupTotal = { leads: 0, conversions: 0, acceptedValuePence: 0 };
    const practiceTotal = new Map();     // practiceId -> { leads, conversions, acceptedValuePence }

    // Deduped across PAID channels only (google_ads + meta_ads) — the
    // denominator the totals cost metrics must use. A person seen solely via
    // an unassigned pipeline costs nothing and must not appear here.
    const seenGroupPaid = new Set();
    const seenPracticePaid = new Map(); // practiceId -> Set(personKey)
    const groupPaid = { leads: 0, conversions: 0 };
    const practicePaid = new Map();     // practiceId -> { leads, conversions }

    const practiceStats = (practiceId, channel) => {
        if (!byPractice.has(practiceId)) {
            byPractice.set(practiceId, new Map(CHANNELS.map((c) => [c, emptyStats(c)])));
        }
        return byPractice.get(practiceId).get(channel);
    };

    // Monthly trend — paid channels only (google_ads/meta_ads); an unassigned
    // pipeline has no spend feed, so a cost-per-lead line for it would be
    // meaningless. Threaded through the SAME `finalise()` funnel as every
    // other derived metric on this page, just bucketed by month instead of by
    // practice.
    const trend = new Map();    // 'YYYY-MM' -> Map<channel, stats>
    const trendSeen = new Map(); // `${month}|${channel}` -> Set(personKey)
    const trendStats = (month, channel) => {
        if (!trend.has(month)) {
            trend.set(month, new Map(AD_CHANNELS.map((c) => [c, emptyStats(c)])));
        }
        return trend.get(month).get(channel);
    };

    // Practice-scoped trend, mirroring the group trend above but keyed also
    // by practice — so selecting a practice on the page can show a trend that
    // actually obeys that scope instead of silently falling back to the
    // group-wide series. Dedup is per (practice, month, channel), the same
    // asymmetry the group/practice split already uses everywhere else in
    // this function: a person seen at two practices in the same month counts
    // once for each practice AND once for the group.
    // Total spend, across all channels, on rows whose ad account did NOT
    // resolve to a practice. Group spend (channels[].spendPence) sums EVERY
    // spend row regardless of mapping, but byPractice only accumulates a row
    // when its account maps to a practice — so whenever some accounts are
    // mapped and others are not (the realistic in-between state, since
    // accounts are mapped one at a time), group spend and the sum of
    // byPractice spend diverge by exactly this amount. It is a real sum over
    // rows that exist, so it is always a number, never null; 0 correctly
    // means "everything attributed".
    let groupOnlySpendPence = 0;

    const trendByPractice = new Map();   // practiceId -> Map<'YYYY-MM', Map<channel, stats>>
    const trendSeenByPractice = new Map(); // `${practiceId}|${month}|${channel}` -> Set(personKey)
    const practiceTrendStats = (practiceId, month, channel) => {
        if (!trendByPractice.has(practiceId)) trendByPractice.set(practiceId, new Map());
        const byMonth = trendByPractice.get(practiceId);
        if (!byMonth.has(month)) {
            byMonth.set(month, new Map(AD_CHANNELS.map((c) => [c, emptyStats(c)])));
        }
        return byMonth.get(month).get(channel);
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

        const matched = matchAcceptedValue(
            { contacts: lead.contacts, practiceId }, acceptedByKey, nameByPractice,
        );

        // Trend covers the two paid channels only — an unassigned pipeline has
        // no spend, so a cost-per-lead line for it would be meaningless.
        //
        // MUST run BEFORE the `continue` guard below: these accumulators are
        // keyed on month|channel (and practice|month|channel), not on `person`
        // alone, so they deliberately admit the same person again in a
        // DIFFERENT month. The guard below only protects accumulators keyed on
        // `person` (± practiceId) and does not know about "month" as a
        // dimension — putting this block after it would silently drop a
        // repeat visitor's second month (see the same-person-two-months test).
        const leadMonth = monthKey(lead.created_at);
        // A blank month (null/missing created_at) must never become an
        // "Invalid Date" point on the trend chart's X axis, so it is skipped
        // for the trend only — the per-channel/practice totals above already
        // counted this lead regardless of date.
        if (AD_CHANNELS.includes(channel) && leadMonth !== '') {
            const m = leadMonth;
            const tKey = `${m}|${channel}`;
            if (!trendSeen.has(tKey)) trendSeen.set(tKey, new Set());
            const tSeen = trendSeen.get(tKey);
            if (!tSeen.has(person)) {
                tSeen.add(person);
                const t = trendStats(m, channel);
                t.leads += 1;
                if (matched) { t.conversions += 1; t.acceptedValuePence += matched.valuePence; }
            }

            const ptKey = `${practiceId}|${m}|${channel}`;
            if (!trendSeenByPractice.has(ptKey)) trendSeenByPractice.set(ptKey, new Set());
            const ptSeen = trendSeenByPractice.get(ptKey);
            if (!ptSeen.has(person)) {
                ptSeen.add(person);
                const pt = practiceTrendStats(practiceId, m, channel);
                pt.leads += 1;
                if (matched) { pt.conversions += 1; pt.acceptedValuePence += matched.valuePence; }
            }
        }

        // Everything from here down is keyed on `person` alone or on
        // `person` + practiceId: groupSeen/practiceSeen, groupTotal/
        // practiceTotal, groupPaid/practicePaid, and the per-channel
        // group/practice stats below. A person already counted under BOTH
        // the group and this practice for this channel has nothing left to
        // add to any of THOSE accumulators, so skip.
        //
        // Do not weaken or delete this guard — it is still correct for what
        // it protects. But any NEW accumulator keyed on something other than
        // `person` (± practiceId) — e.g. month, a date bucket, or any
        // dimension that intentionally admits the same person twice — MUST be
        // computed ABOVE this line, like the trend blocks above. Putting it
        // below silently underreports repeat visitors on that dimension.
        if (!isNewToGroup && !isNewToPractice) continue;
        groupSeen.add(person);
        practiceSeen.add(person);

        const isNewToGroupTotal = !seenGroupTotal.has(person);
        if (isNewToGroupTotal) seenGroupTotal.add(person);
        if (!seenPracticeTotal.has(practiceId)) seenPracticeTotal.set(practiceId, new Set());
        const practiceTotalSeen = seenPracticeTotal.get(practiceId);
        const isNewToPracticeTotal = !practiceTotalSeen.has(person);
        if (isNewToPracticeTotal) practiceTotalSeen.add(person);

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
        if (isNewToGroupTotal) {
            groupTotal.leads += 1;
            if (matched) { groupTotal.conversions += 1; groupTotal.acceptedValuePence += matched.valuePence; }
        }
        if (isNewToPracticeTotal) {
            if (!practiceTotal.has(practiceId)) {
                practiceTotal.set(practiceId, { leads: 0, conversions: 0, acceptedValuePence: 0 });
            }
            const pt = practiceTotal.get(practiceId);
            pt.leads += 1;
            if (matched) { pt.conversions += 1; pt.acceptedValuePence += matched.valuePence; }
        }

        if (AD_CHANNELS.includes(channel)) {
            const isNewToGroupPaid = !seenGroupPaid.has(person);
            if (isNewToGroupPaid) seenGroupPaid.add(person);
            if (!seenPracticePaid.has(practiceId)) seenPracticePaid.set(practiceId, new Set());
            const practicePaidSeen = seenPracticePaid.get(practiceId);
            const isNewToPracticePaid = !practicePaidSeen.has(person);
            if (isNewToPracticePaid) practicePaidSeen.add(person);

            if (isNewToGroupPaid) {
                groupPaid.leads += 1;
                if (matched) groupPaid.conversions += 1;
            }
            if (isNewToPracticePaid) {
                if (!practicePaid.has(practiceId)) practicePaid.set(practiceId, { leads: 0, conversions: 0 });
                const pp = practicePaid.get(practiceId);
                pp.leads += 1;
                if (matched) pp.conversions += 1;
            }
        }
    }

    for (const row of spend || []) {
        if (!AD_CHANNELS.includes(row.provider)) continue;
        const g = group.get(row.provider);
        g.spendPence += row.spend_pence || 0;
        // Practice is resolved live from ad_accounts rather than read off
        // row.practice_id: identical answer (000140 stamps the column from the
        // same mapping), but immune to a row stamped before the most recent
        // remap. Only spend on an account mapped to a practice can be
        // attributed to that practice.
        const rowPractice = adAccountPractice.get(`${row.provider}|${row.customer_id}`) ?? null;
        if (rowPractice) {
            const p = practiceStats(rowPractice, row.provider);
            p.spendPence += row.spend_pence || 0;
        } else {
            groupOnlySpendPence += row.spend_pence || 0;
        }
        const m = monthKey(row.metric_date);
        // A null/blank metric_date must not become an "Invalid Date" point on
        // the trend chart's X axis — skip it for the trend only; the
        // channel/practice totals above already captured this spend.
        if (m === '') continue;
        const t = trendStats(m, row.provider);
        t.spendPence += row.spend_pence || 0;
        if (rowPractice) {
            const pt = practiceTrendStats(rowPractice, m, row.provider);
            pt.spendPence += row.spend_pence || 0;
        }
    }

    // A paid channel with leads but a spend total that never accumulated
    // (still the emptyStats() 0) means that channel's feed is not reporting
    // for this window. Charging the OTHER channel's known spend against
    // every paid lead — including that non-reporting channel's — is the same
    // understatement as the Critical defect, just with a different trigger,
    // so the guard forces both cost metrics to null while still showing
    // whatever spend genuinely IS known.
    const incompleteSpendAcross = (chans) => AD_CHANNELS.some((c) => {
        const s = chans.get(c);
        return s.leads > 0 && s.spendPence === 0;
    });

    // Every trend point — group or practice-scoped — goes through the SAME
    // finalise() funnel as everything else on this page; only the source map
    // (bucketed by month, then by practice) differs.
    const finaliseTrend = (byMonth) => [...byMonth.entries()]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([month, chans]) => ({
            month,
            channels: AD_CHANNELS.map((c) => finalise(chans.get(c), { allowSpend: true })),
        }));

    return {
        channels: CHANNELS.map((c) => finalise(group.get(c), { allowSpend: c !== 'unassigned' })),
        totals: totalsFromStats({
            ...groupTotal,
            paidLeads: groupPaid.leads,
            paidConversions: groupPaid.conversions,
            // 'unassigned' contributes no spend, so only the two ad channels sum.
            spendPence: group.get('google_ads').spendPence + group.get('meta_ads').spendPence,
            incompleteSpend: incompleteSpendAcross(group),
        }),
        byPractice: [...byPractice.entries()].map(([practiceId, chans]) => ({
            practiceId,
            channels: CHANNELS.map((c) => finalise(chans.get(c), { allowSpend: c !== 'unassigned' })),
            total: totalsFromStats({
                ...(practiceTotal.get(practiceId) ?? { leads: 0, conversions: 0, acceptedValuePence: 0 }),
                paidLeads: practicePaid.get(practiceId)?.leads ?? 0,
                paidConversions: practicePaid.get(practiceId)?.conversions ?? 0,
                spendPence: chans.get('google_ads').spendPence + chans.get('meta_ads').spendPence,
                incompleteSpend: incompleteSpendAcross(chans),
            }),
            trend: finaliseTrend(trendByPractice.get(practiceId) ?? new Map()),
        })),
        trend: finaliseTrend(trend),
        excludedUnmappedLeads,
        groupOnlySpendPence,
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

    // What is and is not mapped, across all three mapping surfaces. Deliberately
    // NOT narrowed by practice: its purpose is to show what is missing across
    // the whole group, and a practice filter would hide exactly the rows the
    // operator needs to see.
    async getMappingHealth(orgId) {
        const [adAccountRows, ghlRows, emergentRows, practices, channelMap, feedHealth] = await Promise.all([
            adAttributionRepository.adAccounts(orgId),
            adAttributionRepository.ghlAccounts(orgId),
            adAttributionRepository.emergentBusinesses(orgId),
            adAttributionRepository.practiceOptions(orgId),
            adChannelPipelineRepository.channelMap(orgId),
            adAttributionRepository.adAccountFeedHealth(orgId),
        ]);
        const practiceName = new Map(practices.map((p) => [p.id, p.name]));
        const named = (practiceId) => practiceName.get(practiceId) ?? null;

        const adAccounts = (adAccountRows ?? []).map((a) => {
            const health = feedHealth.get(`${a.provider}|${a.customer_id}`) ?? null;
            const daysStale = health ? health.daysStale : null;
            const feedStatus = !health
                ? 'no-data'
                : (daysStale !== null && daysStale >= FEED_STALE_AFTER_DAYS ? 'stale' : 'reporting');
            return {
                id: a.id,
                provider: a.provider,
                customerId: a.customer_id,
                name: a.name ?? null,
                practiceId: a.practice_id ?? null,
                practiceName: a.practice_id ? named(a.practice_id) : null,
                mapped: a.practice_id !== null && a.practice_id !== undefined,
                lastMetricDate: health ? health.lastMetricDate : null,
                daysStale,
                feedStatus,
            };
        });

        const ghlAccounts = (ghlRows ?? []).map((g) => {
            const unmappedPipelines = g.pipelines.filter(
                (p) => !channelMap.has(pipeKey(g.id, p.id)),
            ).length;
            return {
                id: g.id,
                label: g.label ?? null,
                externalAccountId: g.external_account_id,
                practiceId: g.practice_id,
                practiceName: g.practice_id ? named(g.practice_id) : null,
                mapped: g.practice_id !== null,
                status: g.status,
                pipelineCount: g.pipelines.length,
                unmappedPipelineCount: unmappedPipelines,
            };
        });

        const emergentBusinesses = (emergentRows ?? []).map((e) => ({
            businessId: e.businessId,
            businessName: e.businessName,
            practiceId: e.practiceId,
            practiceName: e.practiceId ? named(e.practiceId) : null,
            mapped: e.practiceId !== null,
        }));

        return {
            adAccounts,
            ghlAccounts,
            emergentBusinesses,
            summary: {
                adAccountsUnmapped: adAccounts.filter((a) => !a.mapped).length,
                ghlAccountsUnmapped: ghlAccounts.filter((g) => !g.mapped).length,
                emergentUnmapped: emergentBusinesses.filter((e) => !e.mapped).length,
                // Only a subaccount that IS mapped to a practice can have
                // mappable pipelines — an academy/accounting Location's
                // pipelines must never inflate this. Same rule as
                // getPerformance's unmappedPipelineCount, so the two agree.
                pipelinesUnmapped: ghlAccounts
                    .filter((g) => g.mapped)
                    .reduce((n, g) => n + g.unmappedPipelineCount, 0),
                adAccountsStale: adAccounts.filter((a) => a.feedStatus === 'stale').length,
                adAccountsNoData: adAccounts.filter((a) => a.feedStatus === 'no-data').length,
            },
        };
    },

    async setPipelineChannel(orgId, accountId, pipelineId, channel) {
        const accounts = await adAttributionRepository.ghlAccounts(orgId);
        const account = accounts.find((a) => a.id === accountId);
        // Rejecting an unknown account is the tenant guard on this write: the
        // account list is already org-scoped. This is ordinary client input
        // (a stale accountId after a disconnect, or a cross-org probe), not a
        // server fault — it must map to 404, not the default 500 a bare Error
        // gets from errorHandler (which also logs + reports to Sentry).
        if (!account) throw new AppError('Unknown subaccount', 404);
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
        // Push the new mapping onto the existing spend rows immediately. A
        // remap that only took effect on the next nightly sync would leave the
        // practice-scoped spend figures reading the previous mapping for up to
        // a day, with nothing on screen to say so.
        const restamped = await adAttributionRepository.restampAdMetricsPractices(orgId);
        // The SAME mapping change has to land on the deep-grain tables too. An
        // account that has stopped syncing never gets re-stamped by a pull, so
        // without this its ad-group/ad/keyword rows keep a stale or NULL
        // practice_id for ever — the exact shape of the incident that had every
        // practice-scoped ad-spend figure in the product reading £0 for months.
        //
        // Non-fatal, and deliberately AFTER the campaign restamp: campaign
        // grain feeds every existing figure in the product, deep grain feeds
        // two new pages. A failure here must not cost the campaign restamp
        // that already succeeded.
        let grainRestamped = 0;
        try {
            grainRestamped = await adGrainRepository.restampPractices(orgId);
        } catch (err) {
            console.error('[ad-attribution] deep-grain restamp failed:', err.message);
        }
        return { ok: true, restamped, grainRestamped };
    },

    async getPerformance(orgId, { since, until, practiceId }) {
        const [channelMap, accounts, leads, accepted, spend, practiceOptions, adAccountRows] = await Promise.all([
            adChannelPipelineRepository.channelMap(orgId),
            adAttributionRepository.ghlAccounts(orgId),
            adAttributionRepository.leadsInWindow(orgId, since, until),
            adAttributionRepository.acceptedForMatching(orgId, since, until),
            adAttributionRepository.adSpend(orgId, since, until),
            adAttributionRepository.practiceOptions(orgId),
            adAttributionRepository.adAccounts(orgId),
        ]);
        const accountPractice = new Map(accounts.map((a) => [a.id, a.practice_id]));
        const practiceName = new Map(practiceOptions.map((p) => [p.id, p.name]));
        const result = computePerformance({
            leads, accepted, spend, channelMap, accountPractice,
            adAccountPractice: accountPracticeByCustomerId(adAccountRows),
        });
        const byPractice = result.byPractice
            .filter((p) => !practiceId || p.practiceId === practiceId)
            .map((p) => ({ ...p, practiceName: practiceName.get(p.practiceId) ?? null }));
        return {
            channels: practiceId
                ? (byPractice[0]?.channels ?? CHANNELS.map((c) => finalise(emptyStats(c), { allowSpend: c !== 'unassigned' })))
                : result.channels,
            totals: practiceId
                ? (byPractice[0]?.total ?? totalsFromStats({
                    leads: 0, conversions: 0, acceptedValuePence: 0, paidLeads: 0, paidConversions: 0, spendPence: 0, incompleteSpend: false,
                }))
                : result.totals,
            byPractice,
            trend: practiceId
                ? (byPractice[0]?.trend ?? [])
                : result.trend,
            excludedUnmappedLeads: result.excludedUnmappedLeads,
            // Always the group-wide figure, regardless of practiceId scope —
            // it describes spend that reaches NO practice, which is a
            // property of the org's mapping state, not of any one practice.
            groupOnlySpendPence: result.groupOnlySpendPence,
            // Only pipelines on a subaccount mapped to a practice are eligible
            // to be mapped at all — a subaccount with practice_id null (the
            // academy/accounting Locations) is excluded from this feature
            // entirely, so its pipelines must never inflate this count.
            unmappedPipelineCount: accounts
                .filter((a) => a.practice_id !== null)
                .reduce((n, a) => n + a.pipelines.filter(
                    (p) => !channelMap.has(pipeKey(a.id, p.id))).length, 0),
        };
    },

    // The drill-in list: one row per person, in the same shape the shared
    // LeadsTable already renders for the cockpit.
    async getLeads(orgId, { since, until, channel, practiceId, limit }) {
        const [channelMap, accounts, leads, accepted, practices] = await Promise.all([
            adChannelPipelineRepository.channelMap(orgId),
            adAttributionRepository.ghlAccounts(orgId),
            adAttributionRepository.leadsInWindow(orgId, since, until),
            adAttributionRepository.acceptedForMatching(orgId, since, until),
            adAttributionRepository.practiceOptions(orgId),
        ]);
        const accountPractice = new Map(accounts.map((a) => [a.id, a.practice_id]));
        const pipelineName = new Map();
        for (const a of accounts) {
            for (const p of a.pipelines) pipelineName.set(pipeKey(a.id, p.id), p.name);
        }
        const practiceName = new Map((practices ?? []).map((p) => [p.id, p.name]));
        const { acceptedByKey, nameByPractice } = buildAcceptedByKey(accepted);

        const rows = [];
        const seen = new Set();
        for (const lead of leads) {
            const practice = accountPractice.get(lead.integration_account_id) ?? null;
            if (practice === null) continue;
            if (practiceId && practice !== practiceId) continue;
            const ch = resolveChannel(channelMap, lead.integration_account_id, lead.ghl_pipeline_id);
            if (channel && ch !== channel) continue;
            const person = `${ch}|${personKey(lead)}`;
            if (seen.has(person)) continue;
            seen.add(person);

            const c = lead.contacts || {};
            const matched = matchAcceptedValue({ contacts: c, practiceId: practice }, acceptedByKey, nameByPractice);
            rows.push({
                id: lead.id,
                contactId: lead.contact_id ?? null,
                // The same identity the dedupe above uses. Exposed so the client
                // can group a person across channels exactly rather than
                // re-deriving it and getting a lower bound.
                personKey: personKey(lead),
                name: [c.first_name, c.last_name].filter(Boolean).join(' ') || null,
                email: c.email ?? null,
                phone: c.phone ?? null,
                channel: ch,
                practiceId: practice,
                practiceName: practiceName.get(practice) ?? null,
                pipelineName: pipelineName.get(pipeKey(lead.integration_account_id, lead.ghl_pipeline_id)) ?? null,
                createdAt: lead.created_at,
                converted: matched !== null,
                matchedTreatmentName: matched?.treatmentName ?? null,
                matchedPatientName: matched?.patientName ?? null,
                matchedAcceptedDate: matched?.acceptedDate ?? null,
                matchedValuePence: matched?.valuePence ?? 0,
            });
            if (rows.length >= limit) break;
        }
        return { leads: rows };
    },

    // Spend broken out per account and per campaign, so the Spend tile has
    // something to open. Practice attribution comes from the ad_accounts join,
    // NOT from ad_metrics.practice_id — that column is null on every row.
    //
    // reach/frequency are deliberately absent: they are not summable across
    // days, and summing them (as growth.routes.js does) overcounts.
    async getSpend(orgId, { since, until, practiceId }) {
        const [rows, accounts, practices] = await Promise.all([
            adAttributionRepository.adSpendDetailed(orgId, since, until),
            adAttributionRepository.adAccounts(orgId),
            adAttributionRepository.practiceOptions(orgId),
        ]);
        const practiceOf = accountPracticeByCustomerId(accounts);
        const accountName = new Map(
            (accounts ?? []).map((a) => [`${a.provider}|${a.customer_id}`, a.name ?? null]),
        );
        const practiceName = new Map((practices ?? []).map((p) => [p.id, p.name]));

        const byAccount = new Map();
        const byCampaign = new Map();
        let unattributedSpendPence = 0;

        for (const r of rows ?? []) {
            // Same guard as computePerformance's spend loop: ad_metrics.provider
            // is only ever google_ads/meta_ads today, so this is a no-op now,
            // but without it the two endpoints silently stop reconciling the
            // day a third provider is synced.
            if (!AD_CHANNELS.includes(r.provider)) continue;
            const acctKey = `${r.provider}|${r.customer_id}`;
            const known = practiceOf.has(acctKey);
            const practice = known ? practiceOf.get(acctKey) : null;
            // Spend on a customer_id with no ad_accounts row cannot be tied to
            // an account at all. Reported separately so byAccount and the group
            // total visibly reconcile rather than quietly disagreeing.
            //
            // Only counted when NO practice filter is applied: spend that
            // cannot be attributed to any account certainly cannot be
            // attributed to a specific practice, so adding it to a
            // practice-scoped view would overstate that practice's spend.
            if (!known) {
                if (!practiceId) unattributedSpendPence += r.spend_pence || 0;
                continue;
            }
            if (practiceId && practice !== practiceId) continue;

            if (!byAccount.has(acctKey)) {
                byAccount.set(acctKey, {
                    customerId: r.customer_id,
                    provider: r.provider,
                    accountName: accountName.get(acctKey) ?? null,
                    practiceId: practice,
                    practiceName: practice ? (practiceName.get(practice) ?? null) : null,
                    spendPence: 0, impressions: 0, clicks: 0, conversions: 0,
                });
            }
            const a = byAccount.get(acctKey);
            a.spendPence += r.spend_pence || 0;
            a.impressions += r.impressions || 0;
            a.clicks += r.clicks || 0;
            a.conversions += r.conversions || 0;

            const campKey = `${acctKey}|${r.campaign_id ?? ''}`;
            if (!byCampaign.has(campKey)) {
                byCampaign.set(campKey, {
                    customerId: r.customer_id,
                    provider: r.provider,
                    campaignId: r.campaign_id ?? null,
                    campaignName: r.campaign_name ?? null,
                    campaignStatus: r.campaign_status ?? null,
                    practiceId: practice,
                    practiceName: practice ? (practiceName.get(practice) ?? null) : null,
                    spendPence: 0, impressions: 0, clicks: 0, conversions: 0,
                });
            }
            const c = byCampaign.get(campKey);
            c.spendPence += r.spend_pence || 0;
            c.impressions += r.impressions || 0;
            c.clicks += r.clicks || 0;
            c.conversions += r.conversions || 0;
        }

        const bySpendDesc = (x, y) => y.spendPence - x.spendPence;
        return {
            byAccount: [...byAccount.values()].sort(bySpendDesc),
            byCampaign: [...byCampaign.values()].sort(bySpendDesc),
            // Under a practice filter this loop deliberately never
            // accumulates unattributed spend (see the `if (!known)` guard
            // above) — a `0` here would falsely read as "everything is
            // attributed" when unattributed spend may still exist at group
            // level. null is the honest "not known/not applicable" signal;
            // only the unscoped, group-wide call returns the real sum.
            unattributedSpendPence: practiceId ? null : unattributedSpendPence,
        };
    },
};
