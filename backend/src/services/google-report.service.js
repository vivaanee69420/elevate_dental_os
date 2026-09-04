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
// Reused, not re-queried: this is the SAME org-scoped map /settings/
// ad-attribution reads and writes (ad-attribution.service.js). leadPerformance
// needs only "has this org mapped ANY pipeline to google_ads at all" — a
// tenant with zero mappings must be told that plainly, not shown a silent
// zero that looks like a quiet period. See leadPerformance's own comment.
import { adChannelPipelineRepository } from "../repositories/ad-channel-pipeline.repository.js";
import { createTtlCache } from "../lib/ttl-cache.js";
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

// leadPerformance()'s window conversion. Same idiom as facebook-report
// .service.js's funnelUntil — kept as a local copy rather than imported
// (that file is a live, separately-owned module) because the shape is
// trivial and the two must never accidentally drift into sharing state:
// ad_provider_spend_by_practice bounds with `<= until` (metric_date IS a
// date, same convention campaignSpendByProvider/ad_grain_rollup use), while
// ad_google_lead_ledger bounds with `< until` (a lead/call carries a time,
// not a date) — so the inclusive `until` a client sends must become
// exclusive ONLY for the ledger call. Handing the same inclusive date to
// both would drop the last day's leads/calls, exactly the bug
// facebook-report.service.js's header documents finding and fixing there.
function leadLedgerUntil(inclusiveUntil) {
    const [y, m, d] = inclusiveUntil.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

// The acceptance floor for CPA (000162): a lead counts as an accepted
// patient once the money it has paid EXCEEDS this, not merely reaches it.
//
// £40 is roughly what an appointment costs at this group, and that is the
// whole point of having a floor at all — without one, every routine exam
// fee reads as a treatment acceptance. Measured live (Plan4growth, Google,
// Jun-Aug 2026, new patients only): 62 of 64 booked leads had paid
// SOMETHING, so a "paid anything" rule reports a 97% acceptance rate and
// tells the reader nothing. At £40 it is 46.
//
// It is a named constant, and a parameter of the RPC beneath it, because
// £40 is THIS group's consultation fee — another tenant's differs. When a
// per-practice fee becomes configurable this is the single place that
// reads it; until then no tenant is silently assumed to charge £40 by a
// literal buried in SQL.
const ACCEPTANCE_MIN_PAID_PENCE = 4000;

// A cost per nothing is unknowable, not free — same guard as withCosts/
// perUnitPence above, applied to the blended lead figures instead of
// Google's own tracked conversions.
function withLeadCosts(row) {
    return {
        ...row,
        cplPence: perUnitPence(row.spendPence, row.leads),
        cpbPence: perUnitPence(row.spendPence, row.booked),
        cpaPence: perUnitPence(row.spendPence, row.accepted),
    };
}

// Merge the spend-by-practice rows and the deduplicated lead ledger into ONE
// row per practice (plus one practice_id:null "unmapped" bucket for spend on
// an account with no practice mapping, or a lead whose practice could not be
// resolved) — a LEFT-join-shaped merge, not an inner one: a practice can
// legitimately have spend with zero leads in a quiet window, or leads with
// zero spend if its account is unmapped/paused. Exported for tests; also the
// function that turns raw rows into what the front end's cards need.
// includeExisting: false (the default, and the owner's own definition of
// CPB/CPA — "consider only new patients, no existing patients in Dentally")
// counts booked/accepted ONLY for leads ad_google_lead_ledger marked
// is_new_patient. true is the toggle the owner asked for after doubting a
// suspiciously low booked count: it counts every match regardless, so the
// two figures can be compared side by side without a second, differently-
// computed query — both read the SAME booked/accepted/is_new_patient
// columns from ONE ledger call, they just gate on is_new_patient differently.
function practiceLeadPerformance(spendRows, ledgerRows, includeExisting = false) {
    const byPractice = new Map();
    const touch = (id, name) => {
        const key = id ?? '__unmapped__';
        let row = byPractice.get(key);
        if (!row) {
            row = {
                practiceId: id ?? null, practiceName: name ?? null,
                spendPence: 0, impressions: 0, clicks: 0,
                leads: 0, booked: 0, accepted: 0,
            };
            byPractice.set(key, row);
        }
        // A practice's name can arrive on either side (spend row or ledger
        // row) first — never let a later null overwrite an earlier real one.
        if (!row.practiceName && name) row.practiceName = name;
        return row;
    };
    for (const s of spendRows ?? []) {
        const row = touch(s.practice_id, s.practice_name);
        row.spendPence += Number(s.spend_pence ?? 0);
        row.impressions += Number(s.impressions ?? 0);
        row.clicks += Number(s.clicks ?? 0);
    }
    for (const l of ledgerRows ?? []) {
        const row = touch(l.practice_id, l.practice_name);
        row.leads += 1;
        const eligible = includeExisting || l.is_new_patient;
        if (l.booked && eligible) row.booked += 1;
        if (l.accepted && eligible) row.accepted += 1;
    }
    return [...byPractice.values()].map(withLeadCosts);
}

function sumPracticeRows(rows) {
    const base = (rows ?? []).reduce((acc, r) => ({
        spendPence: acc.spendPence + r.spendPence,
        impressions: acc.impressions + r.impressions,
        clicks: acc.clicks + r.clicks,
        leads: acc.leads + r.leads,
        booked: acc.booked + r.booked,
        accepted: acc.accepted + r.accepted,
    }), { spendPence: 0, impressions: 0, clicks: 0, leads: 0, booked: 0, accepted: 0 });
    return withLeadCosts(base);
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

// MINOR 5: an ad/keyword row's subtitle carried campaignName but not its
// actual PARENT — the ad group. ad_grain_rollup groups by (entity_id,
// parent_id), and Google reuses a keyword's criterion id across ad groups, so
// an unfiltered Ads/Keywords tab can legitimately render the same entity_id
// (and, for keywords, the same keyword text) several times under the SAME
// campaign with different numbers — the ad group is the only thing that
// disambiguates them, and it was missing entirely.
//
// ads()/keywords() themselves never carry the ad group's name (their own
// rows' parent_id IS the ad group id, but entity_name on those tiers is the
// AD's or KEYWORD's own name) — the ad group's name lives on the
// 'google_adgroup' grain, keyed by that grain's own entity_id. So this is a
// second, small rollup call: 'google_adgroup' rows for the SAME
// practice/campaign scope, reduced to entity_id -> entity_name. Deliberately
// NOT passed `parentId`: on that grain, parent_id means an ad group's own
// PARENT (the campaign), a different id from the ad/keyword-tier `parentId`
// argument (an ad group id) — passing it through would filter ad groups by
// campaign parentage using an ad-group id, which matches nothing.
async function parentAdGroupNames(orgId, win, practiceId, campaignId) {
    const groupRows = await adGrainRepository.rollup(orgId, 'google_adgroup', {
        since: win.since, until: win.until, practiceId, campaignId,
    });
    const names = new Map();
    for (const g of groupRows ?? []) names.set(g.entity_id, g.entity_name ?? null);
    return names;
}

// "No rows in THIS WINDOW" is not evidence a sync has never happened — a
// tenant may have paused every campaign, picked a quiet day, or filtered to a
// practice/campaign/ad group with nothing in it. THREE distinct facts can
// each produce an empty table here, and collapsing them into one message is
// exactly the bug this function fixes:
//
//   1. never_synced        — Google Ads has never landed a single ad_metrics
//                             row for this org, at ANY grain, ever.
//   2. detail_not_synced    — the campaign tier (ad_metrics) IS populated —
//                             totals are real — but THIS grain's own deep
//                             table (ad_google_adgroups/ad_google_ads/
//                             ad_google_keywords) has never received a row
//                             for this org. The deep sync (a separate table,
//                             separate sync phase from the campaign pull)
//                             simply has not run yet. This used to be
//                             unreachable: the old check only ever probed
//                             ad_metrics, so a populated campaign tier beside
//                             an empty deep table returned no_spend_in_window
//                             — telling the owner "there is simply no spend
//                             ... this is not a sync problem" while ruling
//                             out the one true explanation.
//   3. no_spend_in_window   — both ad_metrics AND this grain's own deep table
//                             have received rows before; there just aren't
//                             any in the requested window/filter.
//
// `table` is the CALLING TIER'S OWN deep-grain table — omitted by
// campaigns(), whose own table already IS ad_metrics, so there is no third
// state to distinguish at that tier.
async function emptyWindowState(orgId, table = null) {
    if (!(await marketingRepository.hasProviderMetrics(orgId, PROVIDER))) return 'never_synced';
    if (!table) return 'no_spend_in_window';
    return (await marketingRepository.hasGrainMetrics(orgId, table))
        ? 'no_spend_in_window' : 'detail_not_synced';
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

// leadPerformance's own spend + ledger fetch, cached — measured live at
// ~0.9-1.2s for a 3-month/org window (ad_google_lead_ledger walks leads,
// callrail_calls, contacts, appointments and invoice_items). The owner
// asked for this to be faster; the query itself is already using every
// index available (checked via EXPLAIN ANALYZE — a LATERAL/bool_or rewrite
// to halve the appointments scans was tried and measured SLOWER, 1.2s vs
// 0.9s, because it turns a short-circuiting EXISTS semi-join into a full
// aggregate over every matching row — reverted). The real win is not
// re-running it at all for the same org+window+practice within a short
// window: switching the "include existing patients" toggle no longer
// re-fetches (see leadPerformance, below — both figures are computed from
// ONE fetch), but re-opening the tab, or two components requesting the same
// window, still would without this. Same 60s TTL and reasoning as
// facebook-report.service.js's funnelCache/loadFunnel, which this mirrors.
const leadPerformanceCache = createTtlCache({ ttlMs: 60_000, max: 300 });

async function loadLeadPerformanceData(orgId, since, until) {
    // The acceptance floor is part of the key, not just of the query. It is
    // a constant today, so this changes nothing today — but the moment it
    // becomes per-tenant, a key without it serves one org's cached rows for
    // another org's threshold, and a wrong `accepted` from a warm cache
    // looks exactly like a right one.
    const key = `${orgId}|${since}|${until}|${ACCEPTANCE_MIN_PAID_PENCE}`;
    const hit = leadPerformanceCache.get(key);
    if (hit) return hit;
    return leadPerformanceCache.set(key, await Promise.all([
        marketingRepository.adSpendByPractice(orgId, PROVIDER, since, until),
        marketingRepository.googleLeadLedger(
            orgId, since, leadLedgerUntil(until), ACCEPTANCE_MIN_PAID_PENCE,
        ),
    ]));
}

// Test seam and sync hook: drop one org's cached lead-performance data (or
// all of them) — same shape as facebook-report.service.js's
// invalidateFunnelCache.
export function invalidateLeadPerformanceCache(orgId) {
    leadPerformanceCache.invalidate(orgId ? `${orgId}|` : undefined);
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
                state: await emptyWindowState(orgId, 'ad_google_adgroups'), rows: [], excludedAccounts,
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
                state: await emptyWindowState(orgId, 'ad_google_ads'), rows: [], nextCursor: null, excludedAccounts,
                effectiveSince: win.effectiveSince, windowClamped: win.windowClamped,
            };
        }

        // MINOR 5: the ad group's own name, keyed by parent_id — see
        // parentAdGroupNames. Fetched only now (after the empty-window early
        // return above), so a genuinely empty tab pays no extra query.
        const groupNames = await parentAdGroupNames(orgId, win, practiceId, campaignId);

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
                    parentName: groupNames.get(g.parent_id) ?? null,
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
                state: await emptyWindowState(orgId, 'ad_google_keywords'), rows: [], nextCursor: null, excludedAccounts,
                approximate: APPROXIMATE,
                effectiveSince: win.effectiveSince, windowClamped: win.windowClamped,
            };
        }

        // MINOR 5: same as ads() — see parentAdGroupNames.
        const groupNames = await parentAdGroupNames(orgId, win, practiceId, campaignId);

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
                        parentName: groupNames.get(g.parent_id) ?? null,
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

    // Blended CPL/CPB/CPA cards, PRACTICE grain — not per-campaign/ad-group.
    // Google carries no CRM lead funnel of its own (unlike Meta, which gets
    // one via GoHighLevel's ad_id), and CallRail calls carry no ad/campaign
    // linkage at all, so a per-campaign Google CPL cannot be built from what
    // is stored. What CAN: this practice's Google spend (already stamped by
    // account mapping) divided by every lead (GoHighLevel OR CallRail,
    // phone-deduplicated, Dentally-matched) that landed for that SAME
    // practice in the window — see migration 000158's header for the full
    // reasoning.
    //
    // "Accepted" means the lead has PAID more than ACCEPTANCE_MIN_PAID_PENCE
    // (000162), counting settled payments from the lead's own day onward.
    // It used to mean "the first treatment-plan invoice is marked paid",
    // which missed anyone who handed over money before their plan was
    // invoiced and counted others whose money never reached `payments` at
    // all — see 000162's header for the measurements.
    //
    // `leads` on the response carries every deduplicated lead in scope —
    // name/email/treatment plus its own booked/accepted flags — so the front
    // end's card click-through can list the people behind a number without a
    // second request or a second, potentially-drifted computation.
    async leadPerformance(orgId, { since, until, practiceId = null } = {}) {
        const win = clampWindow(since, until);
        // clampWindow's 92-day floor exists for the DEEP-GRAIN tables only.
        // ad_metrics (spend) holds ~15 months and leads/calls/appointments/
        // invoices have no such cap, so this method takes the RAW requested
        // window (defaulted the same way windowFrom() defaults every other
        // marketing route), not the clamped one — a year-wide request here
        // must not be silently cut to 92 days the way the deep-grain tiers
        // are.
        const rawSince = since ?? win.effectiveSince;
        const rawUntil = until ?? win.until;

        const [accounts, pipelineRows] = await Promise.all([
            googleAccounts(orgId),
            // Fetched unconditionally, including on the not_connected path,
            // so `googlePipelinesMapped` is present on EVERY payload shape —
            // same "present on all three, including the early returns"
            // discipline effectiveSince/windowClamped already follow.
            adChannelPipelineRepository.list(orgId),
        ]);
        // MULTI-TENANT GOTCHA, found live on Plan4growth and worth guarding
        // against for every OTHER tenant too: a org that has never mapped any
        // GoHighLevel pipeline to the google_ads channel (a brand-new tenant,
        // or one that only just connected GoHighLevel) will get leads=0 from
        // ad_google_lead_ledger — correctly, since nothing IS mapped — but
        // that reads identically to "genuinely no leads this period" unless
        // the page is told which one it is. Same class of ambiguity
        // never_synced vs no_spend_in_window exists to resolve elsewhere in
        // this file; this is that same discipline applied to attribution
        // rather than to the sync.
        const googlePipelinesMapped = pipelineRows.some((r) => r.channel === 'google_ads');

        if (accounts.length === 0) {
            return {
                state: 'not_connected', practices: [], total: null, practicesAll: [], totalAll: null, leads: [],
                googlePipelinesMapped,
                acceptanceMinPaidPence: ACCEPTANCE_MIN_PAID_PENCE,
                effectiveSince: rawSince, windowClamped: false,
            };
        }

        // Cached: the owner asked for this to be faster, and the same
        // org+window is fetched again on every navigation back to this page
        // within a minute (or by a second component asking for the same
        // window) — see loadLeadPerformanceData's own comment for what was
        // tried and measured on the query itself.
        const [spendRowsAll, ledgerRowsAll] = await loadLeadPerformanceData(orgId, rawSince, rawUntil);

        // practiceId is an OPTIONAL narrowing filter — omitted (the default,
        // "All practices") returns every practice's own row plus a total
        // summed across all of them; supplied narrows both the breakdown and
        // the total to that one practice, same shape as the campaign/ad-set
        // tiers' own practiceId handling elsewhere in this file.
        const spendRows = practiceId ? spendRowsAll.filter((r) => r.practice_id === practiceId) : spendRowsAll;
        const ledgerRows = practiceId ? ledgerRowsAll.filter((r) => r.practice_id === practiceId) : ledgerRowsAll;

        if (spendRows.length === 0 && ledgerRows.length === 0) {
            return {
                state: await emptyWindowState(orgId), practices: [], total: null, practicesAll: [], totalAll: null, leads: [],
                googlePipelinesMapped,
                acceptanceMinPaidPence: ACCEPTANCE_MIN_PAID_PENCE,
                effectiveSince: rawSince, windowClamped: false,
            };
        }

        // BOTH figures computed from the SAME fetch, in ONE response — the
        // owner-requested "include existing patients" toggle is then a pure
        // client-side read of practicesAll/totalAll instead of practices/
        // total, with NO second network request. Toggling used to re-fetch
        // the whole ~1s query for a decision (new vs including-existing)
        // that never depended on the SQL at all, only on how the already-
        // fetched rows are summed (practiceLeadPerformance's `eligible`
        // gate) — that was the single biggest speed problem here, bigger
        // than anything in the query itself.
        const practices = practiceLeadPerformance(spendRows, ledgerRows, false)
            .sort((a, b) => b.spendPence - a.spendPence);
        const practicesAll = practiceLeadPerformance(spendRows, ledgerRows, true)
            .sort((a, b) => b.spendPence - a.spendPence);

        return {
            state: 'ok',
            practices, total: sumPracticeRows(practices),
            practicesAll, totalAll: sumPracticeRows(practicesAll),
            leads: ledgerRows.map((l) => ({
                practiceId: l.practice_id, practiceName: l.practice_name,
                source: l.source, leadAt: l.lead_at,
                // phone10 is the last-10-digits matching key (right(digits,
                // 10) — see the migration), not a display format. UK-centric
                // display: prepend the national trunk '0' this codebase's
                // own convention drops. Never fabricated when null.
                phone: l.phone10 ? `0${l.phone10}` : null,
                name: l.name, email: l.email, treatment: l.treatment,
                booked: l.booked, accepted: l.accepted, isNewPatient: l.is_new_patient,
                // What `accepted` is actually claiming, in money. Shown in
                // the drill-down so the threshold is visible rather than
                // implied — £43 and £4,300 are both "Yes" without it.
                paidPence: l.paid_pence,
            })),
            googlePipelinesMapped,
            // The floor the `accepted` column was computed against, so the
            // front end labels the card with the REAL threshold instead of
            // hardcoding its own copy of £40 that can drift out of step.
            acceptanceMinPaidPence: ACCEPTANCE_MIN_PAID_PENCE,
            effectiveSince: rawSince, windowClamped: false,
        };
    },
};

export const __test = {
    perUnitPence, ratio, collapseByCampaign, excludedAccountsOf, numOrNull,
    leadLedgerUntil, practiceLeadPerformance, sumPracticeRows, withLeadCosts,
    ACCEPTANCE_MIN_PAID_PENCE,
};
