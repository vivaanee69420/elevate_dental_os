// ============================================================================
// Google report — campaign / ad group / ad / keyword.
//
// HIERARCHY: Campaign -> Ad Group -> { Ads, Keywords }. Ads and keywords are
// SIBLINGS under an ad group — neither contains the other — which is why this
// file has FOUR tiers where facebook-report.service.js has three: Meta's
// hierarchy is a straight Campaign -> Ad Set -> Ad chain with nothing beside
// Ad, while Google splits at the ad group into two parallel leaves. Ads take
// their parent id (an ad group id) exactly as keywords do; neither is nested
// inside the other's response.
//
// MIRRORS facebook-report.service.js ON PURPOSE — same clampWindow, same
// tenant states computed from THIS org's own rows, same perUnitPence
// returning null on a zero denominator. Read that file's header before
// changing this one.
//
// WHAT'S DELIBERATELY DIFFERENT FROM THE FACEBOOK PAGE:
//
//  1. Google reports conversions AND at every grain, Meta does not. The
//     deep sync (google-ads-deep-sync.js) requests metrics.conversions on all
//     three deep streams (ad group, ad, keyword) and ad_grain_rollup /
//     ad_keyword_rollup both return it; the shallow campaign sync
//     (google-ads-sync.js) requests and stores the same metric on ad_metrics.
//     So every row here carries Google's OWN conversions figure and a real
//     cost-per-conversion derived from it — never the CRM funnel, and never
//     leads/booked/attended/patients, which is a Facebook-only concept tied to
//     GoHighLevel ad-id attribution. Google's rows are already fully
//     attributed by the platform itself, so there is no coverage/funnel
//     concept and no notIdentified/unmatchedLeads buckets here at all.
//
//  2. conversions is NUMERIC, not an integer. Google reports modelled
//     (fractional) conversions — 3.5 is a real value in Google's own
//     interface. Every read below uses Number(), never Number.parseInt,
//     and costPerConversionPence divides by the fractional value untouched.
//
//  3. Every one of the four methods returns its own `state`, computed from
//     THIS grain's own rows — same discipline facebook-report.service.js's
//     ads() follows for its grain: a tab showing an empty table must be able
//     to say why from its own data, never borrow another tab's.
//
//  4. Two keyword figures are stated as approximations, not presented as
//     exact, because saying so is the point:
//       - search impression share (+ top / absolute-top) is an
//         IMPRESSION-WEIGHTED AVERAGE over the window, denominator filtered to
//         the days Google actually reported a share (ad_keyword_rollup does
//         this filtering in SQL). Google computes its own range figure from
//         eligible impressions, which the API does not expose, so ours can
//         differ slightly. Spend, clicks and conversions ARE exact.
//       - Quality Score is the LATEST value in the window, not an average —
//         it is a 1-10 grade Google assigns, and averaging grades is
//         meaningless. Also computed in SQL (ad_keyword_rollup).
//     keywords() carries a fixed `approximate` note so the UI can print it.
//
//  5. NO CPL/CPB/CPA/CPL-shaped columns anywhere in this file. Those need
//     CallRail calls and GoHighLevel leads deduplicated to one person per
//     lead — a separate plan with its own migration. An empty column reads
//     worse than an absent one (the same reasoning that dropped the blank
//     Reach column from the Facebook ad-set/ad tiers), so they are not added
//     here at all, not even as a null placeholder.
//
// MULTI-TENANT BY CONSTRUCTION: the org id arrives as an argument, resolved
// by the caller from req.user.organisation_id — under an agency switch that
// is already the sub-account's id. serviceClient (in the repositories this
// file calls) bypasses RLS, so the explicit organisation_id/p_org filter IS
// the isolation; nothing here accepts an org id from anywhere else.
// ============================================================================
import { marketingRepository } from "../repositories/marketing.repository.js";
import { adGrainRepository } from "../repositories/ad-grain.repository.js";
import { isSupportedCurrency } from "../lib/integrations/ad-currency.js";
// Same clamp, same constant, same file — not a re-derived copy that could
// drift. See clampWindow's own comment in facebook-report.service.js for why
// the window must be clamped to what the deep-grain tables can cover at all.
import { clampWindow } from "./facebook-report.service.js";

const PROVIDER = 'google_ads';

// A cost per nothing is unknowable, not free. Returning 0 would render as
// "this campaign/ad group/ad/keyword acquires conversions at no cost".
function perUnitPence(totalPence, units) {
    const n = Number(units ?? 0);
    return n > 0 ? Math.round(Number(totalPence ?? 0) / n) : null;
}

function ratio(numerator, denominator) {
    const d = Number(denominator ?? 0);
    return d > 0 ? Number(numerator ?? 0) / d : null;
}

// Shared cost shape for all four grains. conversions stays fractional
// (Google's own modelled figure) — never rounded or parsed as an int.
function withCosts(base, spendPence, impressions, clicks, conversions) {
    const conv = Number(conversions ?? 0);
    return {
        ...base,
        spendPence,
        impressions,
        clicks,
        ctr: ratio(clicks, impressions),
        cpcPence: perUnitPence(spendPence, clicks),
        conversions: conv,
        costPerConversionPence: perUnitPence(spendPence, conv),
    };
}

// RULING A analogue (facebook-report.service.js): ad_metrics is campaign x
// DAY for google_ads exactly as it is for meta_ads, so
// campaignSpendByProvider returns one row per campaign per day, never one row
// per campaign. Collapse before anything downstream treats a row as "the
// campaign" — same reasoning, same latest-day status pick, plus conversions
// summed alongside spend/impressions/clicks (the one extra field this task
// needs that the Facebook collapse does not carry).
function collapseByCampaign(spendRows) {
    const byCampaign = new Map();
    for (const r of spendRows ?? []) {
        const id = r.campaign_id;
        const acc = byCampaign.get(id) ?? {
            campaign_id: id,
            campaign_name: r.campaign_name ?? null,
            campaign_status: null,
            _statusDate: null,
            spend_pence: 0,
            impressions: 0,
            clicks: 0,
            conversions: 0,
        };
        acc.spend_pence += Number(r.spend_pence ?? 0);
        acc.impressions += Number(r.impressions ?? 0);
        acc.clicks += Number(r.clicks ?? 0);
        acc.conversions += Number(r.conversions ?? 0);
        if (!acc.campaign_name && r.campaign_name) acc.campaign_name = r.campaign_name;
        // Same per-day stamping quirk as Facebook's collapse: campaign_status
        // is written as it stood on the day of that row, so the only
        // defensible collapse is the LATEST day's, picked explicitly by
        // metric_date — never by row order (ad_metrics.id is a random uuid).
        const d = r.metric_date ?? null;
        if (r.campaign_status && (acc._statusDate === null || (d !== null && d >= acc._statusDate))) {
            acc.campaign_status = r.campaign_status;
            acc._statusDate = d;
        }
        byCampaign.set(id, acc);
    }
    return [...byCampaign.values()];
}

// RULING B analogue: adAccountsForProvider is already provider-scoped and
// carries currency, so an empty result IS "no Google account" — no extra
// filtering required.
async function googleAccounts(orgId) {
    return marketingRepository.adAccountsForProvider(orgId, PROVIDER);
}

function excludedAccountsOf(accounts) {
    return (accounts ?? [])
        .filter((a) => !isSupportedCurrency(a.currency))
        .map((a) => ({
            customerId: a.customer_id,
            name: a.name ?? null,
            currency: a.currency,
            reason: 'unsupported_currency',
        }));
}

// "No rows in THIS WINDOW" is not evidence a sync has never happened — a
// tenant may have paused every campaign, picked a quiet day, or filtered to a
// practice/campaign/ad group with nothing in it. Probe OUTSIDE the window:
// has ANY google_ads metric row ever landed for this org? Same signal
// facebook-report.service.js uses for all three of its tiers (it probes
// ad_metrics regardless of which deep table the tier itself reads), reused
// here across all four Google tiers for the same reason: it is a statement
// about whether this org has ever synced Google at all, not about one grain.
async function emptyWindowState(orgId) {
    return (await marketingRepository.hasProviderMetrics(orgId, PROVIDER))
        ? 'no_spend_in_window' : 'never_synced';
}

// Shared early return for "no Google account connected at all" — every one
// of the four methods checks this FIRST and returns its OWN state, same
// discipline facebook-report.service.js's three methods (including ads())
// follow.
function notConnected(win, extra = {}) {
    return {
        state: 'not_connected', rows: [], excludedAccounts: [],
        effectiveSince: win.effectiveSince, windowClamped: win.windowClamped,
        ...extra,
    };
}

// A 1-10 Quality Score, or an impression-share ratio, may come back as
// PostgREST's string serialisation of a SQL numeric (same reason
// ad_meta_funnel's leads/booked/etc. need Number() — see
// marketing.repository.js). null/undefined must stay null, not become 0 or
// NaN.
function numOrNull(v) {
    return v === null || v === undefined ? null : Number(v);
}

// The two approximations keywords() carries, stated so the UI can print them
// rather than presenting either figure as exact. See the file header.
const APPROXIMATE = Object.freeze({
    impressionShare:
        "Impression-weighted average across the window's eligible days. Google computes its own "
      + 'range figure from eligible impressions, which the API does not expose, so this can differ slightly.',
    qualityScore:
        'Latest value in the window, not an average — Quality Score is a 1-10 grade Google assigns, '
      + 'and averaging grades is meaningless.',
});

export const googleReportService = {
    async campaigns(orgId, { since, until, practiceId = null } = {}) {
        const win = clampWindow(since, until);
        const accounts = await googleAccounts(orgId);
        if (accounts.length === 0) return notConnected(win, { totals: null });

        const excludedAccounts = excludedAccountsOf(accounts);
        const spendRowsRaw = await marketingRepository.campaignSpendByProvider(
            orgId, win.since, win.until, PROVIDER, null, practiceId);
        const spendRows = collapseByCampaign(spendRowsRaw);
        if (spendRows.length === 0) {
            return {
                state: await emptyWindowState(orgId), rows: [], excludedAccounts, totals: null,
                effectiveSince: win.effectiveSince, windowClamped: win.windowClamped,
            };
        }

        const rows = spendRows.map((s) => withCosts(
            { id: s.campaign_id, name: s.campaign_name ?? null, status: s.campaign_status ?? null },
            Number(s.spend_pence ?? 0), Number(s.impressions ?? 0), Number(s.clicks ?? 0), Number(s.conversions ?? 0),
        ));

        const totals = withCosts(
            { id: null, name: null, status: null },
            rows.reduce((n, r) => n + r.spendPence, 0),
            rows.reduce((n, r) => n + r.impressions, 0),
            rows.reduce((n, r) => n + r.clicks, 0),
            rows.reduce((n, r) => n + r.conversions, 0),
        );

        return {
            state: 'ok', rows, excludedAccounts, totals,
            effectiveSince: win.effectiveSince, windowClamped: win.windowClamped,
        };
    },

    async adGroups(orgId, { since, until, practiceId = null, campaignId = null } = {}) {
        const win = clampWindow(since, until);
        const accounts = await googleAccounts(orgId);
        if (accounts.length === 0) return notConnected(win);

        const excludedAccounts = excludedAccountsOf(accounts);
        const grainRows = await adGrainRepository.rollup(orgId, 'google_adgroup', {
            since: win.since, until: win.until, practiceId, campaignId,
        });
        if ((grainRows ?? []).length === 0) {
            return {
                state: await emptyWindowState(orgId), rows: [], excludedAccounts,
                effectiveSince: win.effectiveSince, windowClamped: win.windowClamped,
            };
        }

        const rows = grainRows.map((g) => withCosts(
            {
                id: g.entity_id, name: g.entity_name ?? null, status: g.entity_status ?? null,
                campaignId: g.campaign_id ?? null, campaignName: g.campaign_name ?? null,
            },
            Number(g.spend_pence ?? 0), Number(g.impressions ?? 0), Number(g.clicks ?? 0), Number(g.conversions ?? 0),
        ));

        return {
            state: 'ok', rows, excludedAccounts,
            effectiveSince: win.effectiveSince, windowClamped: win.windowClamped,
        };
    },

    async ads(orgId, { since, until, practiceId = null, campaignId = null, parentId = null, cursor = null } = {}) {
        const PAGE = 50;
        const win = clampWindow(since, until);
        const accounts = await googleAccounts(orgId);
        if (accounts.length === 0) return notConnected(win, { nextCursor: null });

        const excludedAccounts = excludedAccountsOf(accounts);
        const grainRows = await adGrainRepository.rollup(orgId, 'google_ad', {
            since: win.since, until: win.until, practiceId, campaignId, parentId,
        });
        if ((grainRows ?? []).length === 0) {
            return {
                state: await emptyWindowState(orgId), rows: [], nextCursor: null, excludedAccounts,
                effectiveSince: win.effectiveSince, windowClamped: win.windowClamped,
            };
        }

        // Same tiebreak as facebook-report.service.js's ads(): spend
        // descending is not a TOTAL order (several zero-spend ads is a normal
        // shape), so entity_id ascending breaks every tie deterministically —
        // cursor paging depends on that stability across calls.
        const all = grainRows
            .slice()
            .sort((a, b) => (Number(b.spend_pence ?? 0) - Number(a.spend_pence ?? 0))
                || String(a.entity_id).localeCompare(String(b.entity_id)))
            .map((g) => withCosts(
                {
                    id: g.entity_id, name: g.entity_name ?? null, status: g.entity_status ?? null,
                    campaignId: g.campaign_id ?? null, campaignName: g.campaign_name ?? null,
                    parentId: g.parent_id ?? null,
                },
                Number(g.spend_pence ?? 0), Number(g.impressions ?? 0), Number(g.clicks ?? 0), Number(g.conversions ?? 0),
            ));

        const start = cursor ? Number(cursor) : 0;
        const page = all.slice(start, start + PAGE);
        const nextCursor = start + PAGE < all.length ? String(start + PAGE) : null;
        return {
            state: 'ok', rows: page, nextCursor, excludedAccounts,
            effectiveSince: win.effectiveSince, windowClamped: win.windowClamped,
        };
    },

    async keywords(orgId, { since, until, practiceId = null, campaignId = null, parentId = null, cursor = null } = {}) {
        const PAGE = 50;
        const win = clampWindow(since, until);
        const accounts = await googleAccounts(orgId);
        if (accounts.length === 0) return notConnected(win, { nextCursor: null, approximate: APPROXIMATE });

        const excludedAccounts = excludedAccountsOf(accounts);
        const grainRows = await adGrainRepository.keywordRollup(orgId, {
            since: win.since, until: win.until, practiceId, campaignId, parentId,
        });
        if ((grainRows ?? []).length === 0) {
            return {
                state: await emptyWindowState(orgId), rows: [], nextCursor: null, excludedAccounts,
                approximate: APPROXIMATE,
                effectiveSince: win.effectiveSince, windowClamped: win.windowClamped,
            };
        }

        const all = grainRows
            .slice()
            .sort((a, b) => (Number(b.spend_pence ?? 0) - Number(a.spend_pence ?? 0))
                || String(a.entity_id).localeCompare(String(b.entity_id)))
            .map((g) => ({
                ...withCosts(
                    {
                        id: g.entity_id, name: g.entity_name ?? null, status: g.entity_status ?? null,
                        campaignId: g.campaign_id ?? null, campaignName: g.campaign_name ?? null,
                        parentId: g.parent_id ?? null,
                    },
                    Number(g.spend_pence ?? 0), Number(g.impressions ?? 0), Number(g.clicks ?? 0), Number(g.conversions ?? 0),
                ),
                matchType: g.match_type ?? null,
                // Latest value in the window, not an average — see APPROXIMATE.
                qualityScore: numOrNull(g.quality_score),
                // Impression-weighted averages — see APPROXIMATE.
                searchImpressionShare: numOrNull(g.search_impression_share),
                searchTopImpressionShare: numOrNull(g.search_top_impression_share),
                searchAbsoluteTopImpressionShare: numOrNull(g.search_absolute_top_impression_share),
            }));

        const start = cursor ? Number(cursor) : 0;
        const page = all.slice(start, start + PAGE);
        const nextCursor = start + PAGE < all.length ? String(start + PAGE) : null;
        return {
            state: 'ok', rows: page, nextCursor, excludedAccounts, approximate: APPROXIMATE,
            effectiveSince: win.effectiveSince, windowClamped: win.windowClamped,
        };
    },
};

export const __test = { perUnitPence, ratio, collapseByCampaign, excludedAccountsOf, numOrNull };
