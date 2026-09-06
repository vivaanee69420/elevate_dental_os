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
// The search-term grain's own, SHALLOWER window. Imported from the connector
// that fills the table rather than re-declared, so the page can never claim to
// show a period the sync does not pull.
import { SEARCH_TERM_WINDOW_DAYS } from "../lib/integrations/google-ads-deep-sync.js";
import { londonDaysAgo, londonYmd } from "../lib/tz.js";

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

// The CPL/CPB/CPA arithmetic lives in lib/marketing/lead-performance.js,
// shared with the Facebook report so the two pages cannot drift into two
// definitions of an acquired patient — see that file's header.
import {
    ACCEPTANCE_MIN_PAID_PENCE, withLeadCosts, practiceLeadPerformance,
    UNATTRIBUTED, campaignLeadPerformance, sumPracticeRows,
} from "../lib/marketing/lead-performance.js";

// How each attributed lead was resolved, and how many were not resolved at all.
//
// Published on the payload so the page can STATE its coverage rather than ask
// anyone to trust a per-campaign cost figure on faith, and so a regression —
// a campaign renamed in a way the alias lookup misses, a CallRail tracking
// template someone edits — shows up as a visible shift in this mix instead of
// as a silent drift in cost per patient.
function attributionCoverage(ledgerRows) {
    const out = { total: 0, attributed: 0, byRoute: {}, unattributedBySource: {} };
    for (const l of ledgerRows ?? []) {
        out.total += 1;
        if (l.campaign_id) {
            out.attributed += 1;
            const route = l.attribution ?? 'unknown';
            out.byRoute[route] = (out.byRoute[route] ?? 0) + 1;
        } else {
            const src = l.source ?? 'unknown';
            out.unattributedBySource[src] = (out.unattributedBySource[src] ?? 0) + 1;
        }
    }
    return out;
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

// The fields migration 000164 added, mapped identically at every grain.
//
// EVERY ONE OF THESE CAN LEGITIMATELY BE NULL, and null here means "Google
// does not report this at this grain", not "zero". Impression share does not
// exist for an individual ad; conversion value does not exist for a campaign
// with no value-tracking conversion action configured. Coercing either to 0
// would render as a confident, wrong number — an ad with 0% impression share
// reads as "you are invisible", which is a very different claim from "Google
// does not measure this here".
//
// ROAS is derived, not stored, and is null unless BOTH sides are known: a
// return on spend where the return is unknown is not 0x.
function googleExtras(g) {
    const valuePence = numOrNull(g.conversions_value_pence);
    const spendPence = Number(g.spend_pence ?? 0);
    return {
        conversionsValuePence: valuePence,
        allConversions: numOrNull(g.all_conversions),
        roas: valuePence !== null && spendPence > 0 ? valuePence / spendPence : null,
        searchImpressionShare: numOrNull(g.search_impression_share),
        searchTopImpressionShare: numOrNull(g.search_top_impression_share),
        searchAbsoluteTopImpressionShare: numOrNull(g.search_absolute_top_impression_share),
        // The two that say WHY share was missed. They are the actionable half:
        // budget-lost means raise the budget, rank-lost means raise the bid or
        // improve the ad. Reporting the headline share without them tells an
        // owner they have a problem and not which lever moves it.
        searchBudgetLostImpressionShare: numOrNull(g.search_budget_lost_impression_share),
        searchRankLostImpressionShare: numOrNull(g.search_rank_lost_impression_share),
    };
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
//
// Deliberately on the LIGHTER ad_grain_rollup, not googleRollup: this needs
// entity_id -> entity_name and nothing else, and ad_google_rollup computes
// five weighted impression-share averages and a conversion-value sum per row
// on the way to returning them. Paying for that to read a label would be
// waste, and the two functions agree on the columns this actually uses.
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

// Campaign-grain spend for the SAME window the cards use.
//
// A SECOND cache rather than a third element of loadLeadPerformanceData's,
// because this one is practice-PARAMETERISED and those two are not. The pair
// above is fetched org-wide once and narrowed in JS, so that switching
// practice costs no request; folding a practice-keyed fetch into the same
// entry would make every practice switch re-run the ~1s ledger query for no
// reason.
const campaignSpendCache = createTtlCache({ ttlMs: 60_000, max: 300 });

async function loadCampaignSpend(orgId, since, until, practiceId) {
    const key = `${orgId}|${since}|${until}|${practiceId ?? ''}`;
    const hit = campaignSpendCache.get(key);
    if (hit) return hit;
    return campaignSpendCache.set(
        key,
        await adGrainRepository.googleCampaignRollup(orgId, { since, until, practiceId }),
    );
}

// Test seam and sync hook: drop one org's cached lead-performance data (or
// all of them) — same shape as facebook-report.service.js's
// invalidateFunnelCache.
export function invalidateLeadPerformanceCache(orgId) {
    leadPerformanceCache.invalidate(orgId ? `${orgId}|` : undefined);
    campaignSpendCache.invalidate(orgId ? `${orgId}|` : undefined);
}

// clampWindow, but to the SEARCH-TERM table's own 30-day window rather than
// the 92-day one every other deep grain keeps. Same string-compare-on-
// YYYY-MM-DD reasoning as clampWindow itself: that format sorts
// lexicographically, and constructing a Date here would reintroduce a
// timezone. Deliberately a second function and not a parameter on clampWindow:
// that one is exported and shared with the Facebook report, and widening its
// signature to serve one Google tab is how a shared clamp starts drifting.
function clampSearchTermWindow(since, until) {
    const floor = londonDaysAgo(SEARCH_TERM_WINDOW_DAYS);
    const effectiveSince = !since || since < floor ? floor : since;
    return {
        since: effectiveSince,
        until: until || londonYmd(),
        effectiveSince,
        windowClamped: Boolean(since) && since < floor,
        windowDays: SEARCH_TERM_WINDOW_DAYS,
    };
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
        // ad_google_campaign_rollup, NOT campaignSpendByProvider +
        // collapseByCampaign. The impression-share figures are IMPRESSION-
        // WEIGHTED AVERAGES over the days Google actually reported one, and
        // that weighting cannot be reconstructed after the fact from rows a
        // plain select returns — the per-day denominators are gone by then.
        // Doing it in SQL also drops one JS collapse of campaign x day rows.
        const spendRows = await adGrainRepository.googleCampaignRollup(orgId, {
            since: win.since, until: win.until, practiceId,
        });
        if (spendRows.length === 0) {
            return {
                state: await emptyWindowState(orgId), rows: [], excludedAccounts, totals: null,
                effectiveSince: win.effectiveSince, windowClamped: win.windowClamped,
            };
        }

        const rows = spendRows.map((s) => ({
            ...withCosts(
                {
                    id: s.entity_id, name: s.entity_name ?? null, status: s.entity_status ?? null,
                    // Google's channel type (SEARCH / PERFORMANCE_MAX /
                    // DISPLAY / VIDEO). Load-bearing on the page, not
                    // decoration: it is what explains a blank keyword column
                    // and a blank impression share on the same row, so the
                    // reader sees "Performance Max has no keywords" instead of
                    // "our data is missing".
                    channelType: s.objective ?? null,
                },
                Number(s.spend_pence ?? 0), Number(s.impressions ?? 0),
                Number(s.clicks ?? 0), Number(s.conversions ?? 0),
            ),
            ...googleExtras(s),
            phoneCalls: numOrNull(s.phone_calls),
        }));

        // SUMS ARE SUMMED; RATIOS ARE NOT. Spend, impressions, clicks,
        // conversions and value add up across campaigns. Impression share does
        // NOT — it is a proportion of each campaign's own eligible auctions,
        // and an average of proportions over different denominators is a
        // number with no referent. So the totals row carries the additive
        // fields and leaves every share null rather than inventing a
        // group-level figure Google itself does not publish.
        const sum = (f) => rows.reduce((n, r) => n + (Number(r[f]) || 0), 0);
        const anyValue = rows.some((r) => r.conversionsValuePence !== null);
        const totalValuePence = anyValue ? sum('conversionsValuePence') : null;
        const totalSpend = sum('spendPence');
        const totals = {
            ...withCosts(
                { id: null, name: null, status: null, channelType: null },
                totalSpend, sum('impressions'), sum('clicks'), sum('conversions'),
            ),
            conversionsValuePence: totalValuePence,
            allConversions: rows.some((r) => r.allConversions !== null) ? sum('allConversions') : null,
            roas: totalValuePence !== null && totalSpend > 0 ? totalValuePence / totalSpend : null,
            phoneCalls: rows.some((r) => r.phoneCalls !== null) ? sum('phoneCalls') : null,
            searchImpressionShare: null,
            searchTopImpressionShare: null,
            searchAbsoluteTopImpressionShare: null,
            searchBudgetLostImpressionShare: null,
            searchRankLostImpressionShare: null,
        };

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
        const grainRows = await adGrainRepository.googleRollup(orgId, 'google_adgroup', {
            since: win.since, until: win.until, practiceId, campaignId,
        });
        if ((grainRows ?? []).length === 0) {
            return {
                state: await emptyWindowState(orgId, 'ad_google_adgroups'), rows: [], excludedAccounts,
                effectiveSince: win.effectiveSince, windowClamped: win.windowClamped,
            };
        }

        const rows = grainRows.map((g) => ({
            ...withCosts(
                {
                    id: g.entity_id, name: g.entity_name ?? null, status: g.entity_status ?? null,
                    campaignId: g.campaign_id ?? null, campaignName: g.campaign_name ?? null,
                },
                Number(g.spend_pence ?? 0), Number(g.impressions ?? 0), Number(g.clicks ?? 0), Number(g.conversions ?? 0),
            ),
            ...googleExtras(g),
        }));

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
        const grainRows = await adGrainRepository.googleRollup(orgId, 'google_ad', {
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
            .map((g) => ({
                ...withCosts(
                    {
                        id: g.entity_id,
                        // entity_name is now the advertiser's own ad label if
                        // they set one, else the ad's FIRST HEADLINE (the
                        // connector falls back — see google-ads-deep-sync.js).
                        // Before that fallback existed this was null on every
                        // ad in this org (0 of 186 named), so the tab was a
                        // list of 12-digit ids.
                        name: g.entity_name ?? null,
                        status: g.entity_status ?? null,
                        campaignId: g.campaign_id ?? null, campaignName: g.campaign_name ?? null,
                        parentId: g.parent_id ?? null,
                        parentName: groupNames.get(g.parent_id) ?? null,
                    },
                    Number(g.spend_pence ?? 0), Number(g.impressions ?? 0), Number(g.clicks ?? 0), Number(g.conversions ?? 0),
                ),
                ...googleExtras(g),
                adType: g.ad_type ?? null,
                adStrength: g.ad_strength ?? null,
                approvalStatus: g.approval_status ?? null,
                finalUrl: g.final_url ?? null,
                // The creative itself. Arrays of plain strings — the connector
                // flattens Google's {text, pinnedField} assets so no reader has
                // to know that shape.
                headlines: Array.isArray(g.headlines) ? g.headlines : null,
                descriptions: Array.isArray(g.descriptions) ? g.descriptions : null,
            }));

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
        const grainRows = await adGrainRepository.googleRollup(orgId, 'google_keyword', {
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
                // Impression-weighted averages and conversion value — see
                // APPROXIMATE and googleExtras.
                ...googleExtras(g),
                matchType: g.match_type ?? null,
                // Latest value in the window, not an average — see APPROXIMATE.
                qualityScore: numOrNull(g.quality_score),
            }));

        const start = cursor ? Number(cursor) : 0;
        const page = all.slice(start, start + PAGE);
        const nextCursor = start + PAGE < all.length ? String(start + PAGE) : null;
        return {
            state: 'ok', rows: page, nextCursor, excludedAccounts, approximate: APPROXIMATE,
            effectiveSince: win.effectiveSince, windowClamped: win.windowClamped,
        };
    },

    // ========================================================================
    // SEARCH TERMS — what people actually typed, as opposed to what we bid on.
    //
    // The one Google report that says where money is LEAKING, and it cannot be
    // derived from anything else stored: a dental group paying for "dental
    // nurse jobs" or "dentist salary uk" finds out here and nowhere else.
    //
    // TWO THINGS THIS TIER DOES DIFFERENTLY, both deliberate:
    //
    //  1. A 30-DAY WINDOW, not the 92 every other deep grain keeps. Search
    //     terms are (term x ad group x day), an order of magnitude more rows
    //     than any other grain, and the report is one you act on for RECENT
    //     traffic — you mine last month's terms for negatives, not last
    //     quarter's. The clamp is reported, not silent, so the page says which
    //     period it is showing.
    //
    //  2. Rows carry the KEYWORD THAT CAUGHT THE TERM and Google's own
    //     ADDED/EXCLUDED/NONE status. The keyword is the actionable half —
    //     "this broad-match keyword is pulling in this rubbish" — and the
    //     status is what stops the same term being re-reported as actionable
    //     every month after someone has already excluded it.
    // ========================================================================
    async searchTerms(orgId, { since, until, practiceId = null, campaignId = null, parentId = null, cursor = null } = {}) {
        const PAGE = 50;
        const win = clampSearchTermWindow(since, until);
        const accounts = await googleAccounts(orgId);
        if (accounts.length === 0) {
            return { ...notConnected(win, { nextCursor: null }), windowDays: win.windowDays };
        }

        const excludedAccounts = excludedAccountsOf(accounts);
        const grainRows = await adGrainRepository.googleRollup(orgId, 'google_search_term', {
            since: win.since, until: win.until, practiceId, campaignId, parentId,
        });
        if ((grainRows ?? []).length === 0) {
            return {
                state: await emptyWindowState(orgId, 'ad_google_search_terms'),
                rows: [], nextCursor: null, excludedAccounts, windowDays: win.windowDays,
                effectiveSince: win.effectiveSince, windowClamped: win.windowClamped,
            };
        }

        const groupNames = await parentAdGroupNames(orgId, win, practiceId, campaignId);

        // SORTED BY SPEND DESCENDING, like every other tier — and here that
        // ordering IS the product: the terms at the top are the ones costing
        // the most, which is exactly the list someone mining for negatives
        // wants. entity_id (the term text) breaks ties deterministically, which
        // cursor paging depends on across calls.
        const all = grainRows
            .slice()
            .sort((a, b) => (Number(b.spend_pence ?? 0) - Number(a.spend_pence ?? 0))
                || String(a.entity_id).localeCompare(String(b.entity_id)))
            .map((g) => ({
                ...withCosts(
                    {
                        // The term text IS the id — Google gives a search term
                        // no id of its own because it is not an object in the
                        // account, it is a string a stranger typed.
                        id: g.entity_id, name: g.entity_name ?? g.entity_id, status: g.entity_status ?? null,
                        campaignId: g.campaign_id ?? null, campaignName: g.campaign_name ?? null,
                        parentId: g.parent_id ?? null,
                        parentName: groupNames.get(g.parent_id) ?? null,
                    },
                    Number(g.spend_pence ?? 0), Number(g.impressions ?? 0), Number(g.clicks ?? 0), Number(g.conversions ?? 0),
                ),
                ...googleExtras(g),
                keywordText: g.keyword_text ?? null,
                matchType: g.match_type ?? null,
                // ADDED / EXCLUDED / NONE — whether anyone has acted on it.
                termStatus: g.search_term_status ?? null,
            }));

        const start = cursor ? Number(cursor) : 0;
        const page = all.slice(start, start + PAGE);
        const nextCursor = start + PAGE < all.length ? String(start + PAGE) : null;
        return {
            state: 'ok', rows: page, nextCursor, excludedAccounts, windowDays: win.windowDays,
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
                campaigns: [], campaignsAll: [], attribution: attributionCoverage([]),
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
        const [[spendRowsAll, ledgerRowsAll], campaignRows] = await Promise.all([
            loadLeadPerformanceData(orgId, rawSince, rawUntil),
            // Practice-scoped at the SOURCE, not filtered afterwards: the
            // campaign rollup groups by campaign only, so there is no
            // practice column left to narrow on once it returns.
            loadCampaignSpend(orgId, rawSince, rawUntil, practiceId),
        ]);

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
                campaigns: [], campaignsAll: [], attribution: attributionCoverage([]),
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

        // PER-CAMPAIGN, the same two ways as per-practice: new patients only
        // (the owner's own definition) and including existing, both computed
        // from the SAME already-fetched rows so the toggle costs no request
        // and the two figures cannot drift apart.
        //
        // Sorted by spend descending, with the unattributed bucket LAST
        // regardless of size — it is a caveat about the table, not a row that
        // competes in it, and letting it sort to the top on a low-coverage
        // window would bury the campaigns the reader came for.
        const byCampaignSpend = (a, b) => (a.attributed === b.attributed
            ? b.spendPence - a.spendPence
            : (a.attributed ? -1 : 1));
        const campaigns = campaignLeadPerformance(campaignRows, ledgerRows, false).sort(byCampaignSpend);
        const campaignsAll = campaignLeadPerformance(campaignRows, ledgerRows, true).sort(byCampaignSpend);

        return {
            state: 'ok',
            practices, total: sumPracticeRows(practices),
            practicesAll, totalAll: sumPracticeRows(practicesAll),
            campaigns, campaignsAll,
            // Stated, not implied — see attributionCoverage.
            attribution: attributionCoverage(ledgerRows),
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
                // Which campaign bought this lead, and how we know. Null
                // campaignId is a real answer — "could not be tied to one" —
                // and the drill-down says so rather than leaving a blank cell
                // that reads as a rendering fault.
                campaignId: l.campaign_id, campaignName: l.campaign_name,
                adGroupId: l.ad_group_id, adGroupName: l.ad_group_name,
                keywordId: l.keyword_id, keywordText: l.keyword_text,
                attribution: l.attribution,
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
    perUnitPence, ratio, excludedAccountsOf, numOrNull,
    leadLedgerUntil, practiceLeadPerformance, sumPracticeRows, withLeadCosts,
    campaignLeadPerformance, attributionCoverage, googleExtras,
    clampSearchTermWindow, UNATTRIBUTED,
    ACCEPTANCE_MIN_PAID_PENCE,
};
