// ============================================================================
// Facebook report — campaign / ad set / ad, with the funnel and the costs.
//
// MULTI-TENANT BY CONSTRUCTION. Three rules do the work:
//
//  1. The org id arrives as an argument, resolved by the caller from
//     req.user.organisation_id. Under an agency switch that is already the
//     sub-account's id, so this service works per tenant with no extra code.
//
//  2. Nothing here tests a CRM's own vocabulary. A lead is a Meta lead
//     because ad_meta_funnel resolved its ad_id inside this org's ad_meta_ads
//     rows — never because a CRM field said so. An earlier design keyed a
//     lead's channel off GoHighLevel's own attribution_source column holding
//     the literal label "Paid Social" — a tenant whose CRM names that channel
//     differently, or isn't GoHighLevel at all, would have seen an empty
//     report that looked perfectly healthy. That field/label pair must never
//     reappear here as a gate on what counts as a Meta lead. (The vocabulary
//     guard test strips comments before it greps the source, precisely so
//     this paragraph is allowed to name them. It catches reintroducing these
//     two historical strings, not every possible way of coupling to a CRM's
//     vocabulary — the structural join above is what actually guarantees the
//     behaviour.)
//
//  3. A non-GBP Meta account is refused, not converted, using the SAME guard
//     the sync itself applies (isSupportedCurrency) — so this page reports
//     exactly what the sync excluded, never a wrong total that looks right.
//     spendToPence divides Meta's own figure and calls it pence with no FX
//     conversion; the sync already never pulls rows for such an account, so
//     excludedAccounts is purely informational — telling the owner why an
//     account they connected shows no data here.
//
// Every coverage figure is computed from THIS org's rows and returned for
// display — each tenant's own coverage, never a hardcoded or assumed one.
// ============================================================================
import { marketingRepository } from "../repositories/marketing.repository.js";
import { adGrainRepository } from "../repositories/ad-grain.repository.js";
import { isSupportedCurrency } from "../lib/integrations/ad-currency.js";
import { londonDaysAgo, londonYmd } from "../lib/tz.js";
import { DEEP_WINDOW_DAYS } from "../lib/integrations/google-ads-deep-sync.js";
import { createTtlCache } from "../lib/ttl-cache.js";

// ---------------------------------------------------------------------------
// The funnel and the spend readers disagree about `until` ON PURPOSE, and the
// conversion belongs here rather than in either of them.
//
// ad_meta_funnel bounds leads with `l.created_at >= $2 AND l.created_at < $3`
// — a half-open timestamptz range — because a lead carries a time, not a date.
// campaignSpendByProvider and ad_grain_rollup bound with `<= until` because
// metric_date IS a date, and that inclusive convention is the one the
// reconciliation endpoint documents and depends on; changing either of them
// would break it.
//
// Handing the same inclusive YYYY-MM-DD to both loses the last day's leads:
// measured on live data, an August view returned 1,295 leads against a true
// 1,336 (3.1% lost, every month, permanently inflating every CPL/CPB/CPA),
// and a single-day selection — which FacebookQuerySchema explicitly accepts
// and the period bar can produce in two clicks — returned ZERO leads beside
// that day's real spend, with no caveat on screen.
//
// EVERY metaFunnel call in this file must go through this. The spend readers
// must NOT.
function funnelUntil(inclusiveUntil) {
    const [y, m, d] = inclusiveUntil.split('-').map(Number);
    // Day-field arithmetic through Date.UTC, never a milliseconds addition:
    // a fixed 86_400_000 is wrong on the UK spring-forward day. Date.UTC also
    // rolls a day past the end of the month/year over correctly.
    return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

// The funnel is the expensive read on this page: ad_meta_funnel runs through
// ad_lead_conversions, documented at 2.8s for 10,429 rows, and it is
// org-wide — neither campaign nor ad set narrows what it computes, because
// the cost is in resolving every lead in the window, not in the grouping.
//
// Without this cache, expanding five ad sets on the ad-set screen fires five
// `ads()` calls, each re-running that whole computation for the SAME
// org+window+practice. This codebase has already taken a statement timeout
// from fan-out rather than volume (see the Business Hub cache in
// analytics.service.js, whose 60s TTL and reasoning this mirrors).
//
// The key leads with the org id, so an entry can never be read by another
// tenant, and 60s is short enough that a finished sync shows up promptly.
const funnelCache = createTtlCache({ ttlMs: 60_000, max: 300 });

async function loadFunnel(orgId, since, inclusiveUntil, practiceId) {
    const key = `${orgId}|${since}|${inclusiveUntil}|${practiceId ?? ''}`;
    const hit = funnelCache.get(key);
    if (hit) return hit;
    return funnelCache.set(
        key,
        await marketingRepository.metaFunnel(orgId, since, funnelUntil(inclusiveUntil), practiceId),
    );
}

// Test seam and sync hook: drop one org's cached funnels (or all of them).
export function invalidateFunnelCache(orgId) {
    funnelCache.invalidate(orgId ? `${orgId}|` : undefined);
}

// A cost per nothing is unknowable, not free. Returning 0 would render as
// "this campaign acquires patients at no cost".
function perUnitPence(totalPence, units) {
    const n = Number(units ?? 0);
    return n > 0 ? Math.round(Number(totalPence ?? 0) / n) : null;
}

function ratio(numerator, denominator) {
    const d = Number(denominator ?? 0);
    return d > 0 ? Number(numerator ?? 0) / d : null;
}

function sumFunnel(rows) {
    return (rows ?? []).reduce((acc, r) => ({
        leads: acc.leads + Number(r.leads ?? 0),
        booked: acc.booked + Number(r.booked ?? 0),
        attended: acc.attended + Number(r.attended ?? 0),
        patients: acc.patients + Number(r.patients ?? 0),
        newPatients: acc.newPatients + Number(r.new_patients ?? 0),
    }), { leads: 0, booked: 0, attended: 0, patients: 0, newPatients: 0 });
}

function withCosts(base, spendPence, impressions, clicks, funnel) {
    return {
        ...base,
        spendPence,
        impressions,
        clicks,
        ctr: ratio(clicks, impressions),
        cpcPence: perUnitPence(spendPence, clicks),
        leads: funnel.leads,
        booked: funnel.booked,
        attended: funnel.attended,
        patients: funnel.patients,
        newPatients: funnel.newPatients,
        cplPence: perUnitPence(spendPence, funnel.leads),
        cpbPence: perUnitPence(spendPence, funnel.booked),
        cpaPence: perUnitPence(spendPence, funnel.patients),
    };
}

// Coverage is this tenant's own figure, never an assumed one.
function coverageOf(funnelRows) {
    const leadsTotal = (funnelRows ?? []).reduce((n, r) => n + Number(r.leads ?? 0), 0);
    const leadsWithAdSet = (funnelRows ?? [])
        .filter((r) => r.ad_set_id)
        .reduce((n, r) => n + Number(r.leads ?? 0), 0);
    return {
        leadsTotal,
        leadsWithAdSet,
        pct: leadsTotal > 0 ? Math.round((leadsWithAdSet / leadsTotal) * 100) : 0,
    };
}

// RULING A: ad_metrics is campaign x DAY, so campaignSpendByProvider returns
// many rows per campaign — one per day the campaign spent, not one per
// campaign. Collapse before anything downstream treats a row as "the
// campaign": without this a campaign table would render one row per
// campaign-day, and every cost would divide spend by a single day's funnel
// against a single day's spend instead of the whole window's.
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
        };
        acc.spend_pence += Number(r.spend_pence ?? 0);
        acc.impressions += Number(r.impressions ?? 0);
        acc.clicks += Number(r.clicks ?? 0);
        if (!acc.campaign_name && r.campaign_name) acc.campaign_name = r.campaign_name;
        // campaign_status is stamped PER DAY: the sync writes each day's row
        // with the campaign's status as it stood when that sync ran, so a
        // campaign paused on the 12th reads ACTIVE on days before it and
        // PAUSED after. Collapsing the window therefore has to pick one, and
        // the only defensible pick is the LATEST day's — the status the
        // campaign is in now, which is what a status column means on a report.
        //
        // Explicitly by metric_date, never by row order: ad_metrics.id is a
        // random uuid, so "the last row we happened to read" is arbitrary and
        // would flip between reads. Dropping the field entirely (the previous
        // behaviour) left `status` null on every row, which is the whole
        // reason the repository's select carries it.
        const d = r.metric_date ?? null;
        if (r.campaign_status && (acc._statusDate === null || (d !== null && d >= acc._statusDate))) {
            acc.campaign_status = r.campaign_status;
            acc._statusDate = d;
        }
        byCampaign.set(id, acc);
    }
    return [...byCampaign.values()];
}

// RULING B: adAccounts() answers a different question (practice mapping) and
// does not select currency at all — the column this page needs to decide
// whether an account's spend can even be trusted as pence. adAccountsForProvider
// carries currency and is already scoped to one provider, so an empty result
// IS "no Meta account", no extra filtering required.
async function metaAccounts(orgId) {
    return marketingRepository.adAccountsForProvider(orgId, 'meta_ads');
}

// "No spend rows in THIS WINDOW" is not evidence that a sync has never
// happened, and telling a synced tenant "no performance data has arrived yet"
// when they simply paused their campaigns two months ago, picked a quiet day,
// or filtered to a practice whose mapped account did not buy this campaign is
// a plain untruth.
//
// So probe OUTSIDE the window: has ANY Meta metric row ever landed for this
// org? That is the only trustworthy signal — deliberately not
// ad_accounts.period_synced_at, which records that a sync RAN and the window
// it ASKED for, not what came back (migration 000116's header documents a live
// account showing a clean sync through June 2026 with zero metric rows ever).
// Called only on the empty-window path, so the normal path pays nothing.
async function emptyWindowState(orgId) {
    return (await marketingRepository.hasProviderMetrics(orgId, 'meta_ads'))
        ? 'no_spend_in_window' : 'never_synced';
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

// The deep-grain tables hold a rolling 92-day window (their nightly replace
// deletes an account's rows outright and reinserts the window), while
// ad_metrics holds roughly fifteen months. So a caller may legitimately ask
// for a year — and we must NOT answer it by dividing 92 days of ad-set spend
// by a year of leads. Clamp the whole request to what the finest grain can
// actually cover, apply the SAME window to the funnel, the rollups and the
// campaign spend so all three agree, and report the clamp so the page can
// say plainly what it is showing instead of quietly showing something else.
//
// The comparison below is a plain string compare on YYYY-MM-DD, which is
// correct precisely because that format sorts lexicographically — do not
// "fix" this into a Date construction, which would reintroduce a timezone.
export function clampWindow(since, until) {
    const floor = londonDaysAgo(DEEP_WINDOW_DAYS);
    const effectiveSince = !since || since < floor ? floor : since;
    return {
        since: effectiveSince,
        until: until || londonYmd(),
        effectiveSince,
        windowClamped: Boolean(since) && since < floor,
    };
}

export const facebookReportService = {
    async campaigns(orgId, { since, until, practiceId = null } = {}) {
        const win = clampWindow(since, until);
        const accounts = await metaAccounts(orgId);
        if (accounts.length === 0) {
            return {
                state: 'not_connected', coverage: null, rows: [], excludedAccounts: [], totals: null, unmatchedLeads: null,
                effectiveSince: win.effectiveSince, windowClamped: win.windowClamped,
            };
        }
        const excludedAccounts = excludedAccountsOf(accounts);

        // PRACTICE SCOPE, BOTH SIDES. campaignSpendByProvider used to take no
        // practice at all while the funnel beside it took one, so a
        // five-practice group filtering to ONE practice divided the whole
        // group's Meta spend by that practice's leads — every cost figure
        // roughly 5x the truth, a group-wide Total under a practice-specific
        // heading, and an ad-set tier (which always did filter) contradicting
        // the campaign tier above it.
        //
        // SEMANTIC ASYMMETRY, deliberate and not reconcilable: ad_metrics' and
        // the deep tables' practice_id is stamped from the AD ACCOUNT's
        // practice mapping, while the funnel's practice_id is the LEAD's own
        // routing. A practice-scoped row can therefore legitimately show spend
        // with no leads (an account mapped here whose leads routed elsewhere)
        // or leads with no spend (leads routed here from an unmapped or
        // differently-mapped account). Do not try to make the two agree — they
        // answer different questions; just know that is why they can differ.
        const [spendRowsRaw, funnelRows] = await Promise.all([
            marketingRepository.campaignSpendByProvider(orgId, win.since, win.until, 'meta_ads', null, practiceId),
            loadFunnel(orgId, win.since, win.until, practiceId),
        ]);

        const spendRows = collapseByCampaign(spendRowsRaw);
        if (spendRows.length === 0) {
            return {
                state: await emptyWindowState(orgId), coverage: null, rows: [], excludedAccounts,
                totals: null, unmatchedLeads: null,
                effectiveSince: win.effectiveSince, windowClamped: win.windowClamped,
            };
        }

        // ad_meta_funnel's Meta restriction is NOT date-scoped — provider
        // identity isn't a windowed question — while campaignSpendByProvider
        // IS. So a Meta campaign that spent outside this window but produced
        // a lead inside it shows up in funnelRows with no matching row in
        // spendRows. Folding that lead into totals would inflate
        // totals.leads while contributing nothing to totals.spendPence,
        // silently UNDERSTATING every cost-per-X figure. Coverage and totals
        // are therefore scoped to campaigns this window actually has spend
        // for — the campaigns actually on screen — and the remainder is
        // stated as unmatchedLeads rather than dropped or silently folded
        // in. Same idiom as adSets()'s notIdentified bucket, and the correct
        // scope for coverage too: it answers "what share of THIS WINDOW's
        // attributable Meta leads reached an ad set", and a lead whose
        // campaign has no spend in the window is not part of that question.
        const matchedCampaignIds = new Set(spendRows.map((s) => s.campaign_id));
        const matchedFunnelRows = (funnelRows ?? []).filter((r) => matchedCampaignIds.has(r.campaign_id));
        const unmatchedFunnel = sumFunnel((funnelRows ?? []).filter((r) => !matchedCampaignIds.has(r.campaign_id)));
        const unmatchedLeads = unmatchedFunnel.leads > 0 ? unmatchedFunnel : null;

        const coverage = coverageOf(matchedFunnelRows);
        const byCampaign = new Map();
        for (const r of matchedFunnelRows) {
            const list = byCampaign.get(r.campaign_id) ?? [];
            list.push(r);
            byCampaign.set(r.campaign_id, list);
        }

        const rows = spendRows.map((s) => withCosts(
            { id: s.campaign_id, name: s.campaign_name ?? null, status: s.campaign_status ?? null },
            Number(s.spend_pence ?? 0), Number(s.impressions ?? 0), Number(s.clicks ?? 0),
            sumFunnel(byCampaign.get(s.campaign_id) ?? []),
        ));

        const totals = withCosts(
            { id: null, name: null, status: null },
            rows.reduce((n, r) => n + r.spendPence, 0),
            rows.reduce((n, r) => n + r.impressions, 0),
            rows.reduce((n, r) => n + r.clicks, 0),
            sumFunnel(matchedFunnelRows),
        );

        // A tenant whose CRM sends no ad ids cannot have an ad-set tier. Say so
        // and show the platform metrics, rather than render one useless row.
        // Guarded on leadsTotal > 0: a quiet week with zero leads is not
        // evidence about ad-id coverage and must never be reported as if it
        // were — do not simplify this guard away.
        const state = coverage.leadsTotal > 0 && coverage.leadsWithAdSet === 0
            ? 'no_ad_id_coverage' : 'ok';
        return {
            state, coverage, rows, excludedAccounts, totals, unmatchedLeads,
            effectiveSince: win.effectiveSince, windowClamped: win.windowClamped,
        };
    },

    async adSets(orgId, campaignId, { since, until, practiceId = null } = {}) {
        const win = clampWindow(since, until);
        const accounts = await metaAccounts(orgId);
        if (accounts.length === 0) {
            return {
                state: 'not_connected', coverage: null, rows: [], notIdentified: null, unmatchedLeads: null,
                effectiveSince: win.effectiveSince, windowClamped: win.windowClamped,
            };
        }

        const [grainRows, funnelRows] = await Promise.all([
            adGrainRepository.rollup(orgId, 'meta_adset', { since: win.since, until: win.until, practiceId, campaignId }),
            loadFunnel(orgId, win.since, win.until, practiceId),
        ]);

        const forCampaign = (funnelRows ?? []).filter((r) => r.campaign_id === campaignId);
        const coverage = coverageOf(forCampaign);

        const byAdSet = new Map();
        for (const r of forCampaign) {
            if (!r.ad_set_id) continue;
            const list = byAdSet.get(r.ad_set_id) ?? [];
            list.push(r);
            byAdSet.set(r.ad_set_id, list);
        }

        // No `reach` here. ad_grain_rollup's RETURNS TABLE does not include
        // it — the column IS stored on ad_meta_adsets, but the rollup never
        // returns it, so `g.reach` was permanently undefined and every ad set
        // rendered an em dash under a header explaining a number that never
        // appeared. Surfacing it properly needs a new RPC and a migration; an
        // always-empty column is worse than no column, so the column is gone
        // until that exists.
        const rows = (grainRows ?? []).map((g) => withCosts(
            { id: g.entity_id, name: g.entity_name ?? null, status: g.entity_status ?? null },
            Number(g.spend_pence ?? 0), Number(g.impressions ?? 0), Number(g.clicks ?? 0),
            sumFunnel(byAdSet.get(g.entity_id) ?? []),
        ));

        // TWO buckets, because there are two distinct ways a lead can fail to
        // land in a row above, and collapsing them loses leads outright.
        //
        //  - notIdentified: the ad set could not be resolved at all (ad_set_id
        //    null). Meta never told us which ad set the lead came from.
        //  - unmatchedLeads: the ad set RESOLVED, but is not among the rows on
        //    screen — it had no delivery in this window, or its spend sits
        //    under a different practice mapping than the current filter.
        //
        // Before the second bucket existed those leads appeared in no row and
        // in no bucket: a campaign row saying 100 leads could render as 60 in
        // the table plus a 20-lead "not identified" row, with 20 simply gone.
        // rows + notIdentified + unmatchedLeads now reconciles exactly to the
        // campaign tier's row for this campaign — there is a test pinning that.
        const shownAdSetIds = new Set((grainRows ?? []).map((g) => g.entity_id));
        const orphan = sumFunnel(forCampaign.filter((r) => !r.ad_set_id));
        const notIdentified = orphan.leads > 0 ? orphan : null;
        const unmatched = sumFunnel(
            forCampaign.filter((r) => r.ad_set_id && !shownAdSetIds.has(r.ad_set_id)));
        const unmatchedLeads = unmatched.leads > 0 ? unmatched : null;

        // Same guard as campaigns(): zero leads in the window is not evidence
        // of missing ad-id coverage, only a quiet window. Do not drop the
        // leadsTotal > 0 check. And an empty rollup is not evidence of a
        // missing sync either — see emptyWindowState.
        const state = (grainRows ?? []).length === 0 ? await emptyWindowState(orgId)
            : coverage.leadsTotal > 0 && coverage.leadsWithAdSet === 0 ? 'no_ad_id_coverage' : 'ok';
        return {
            state, coverage, rows, notIdentified, unmatchedLeads,
            effectiveSince: win.effectiveSince, windowClamped: win.windowClamped,
        };
    },

    async ads(orgId, adSetId, { since, until, practiceId = null, cursor = null } = {}) {
        const PAGE = 50;
        const win = clampWindow(since, until);
        const [grainRows, funnelRows] = await Promise.all([
            adGrainRepository.rollup(orgId, 'meta_ad', { since: win.since, until: win.until, practiceId, parentId: adSetId }),
            // Cached: this is the call every ad-set expansion used to re-run
            // in full. See loadFunnel.
            loadFunnel(orgId, win.since, win.until, practiceId),
        ]);

        const byAd = new Map();
        for (const r of funnelRows ?? []) {
            if (!r.ad_id) continue;
            const list = byAd.get(r.ad_id) ?? [];
            list.push(r);
            byAd.set(r.ad_id, list);
        }

        // Sorted primarily by spend descending, but spend alone is not a
        // TOTAL order — several zero-spend ads is an entirely normal shape
        // for a small practice, and a tie left to whatever order the
        // repository happened to return would not be guaranteed stable
        // across two calls. Cursor paging depends on exactly that stability:
        // an unstable order across calls can skip or repeat a row at the
        // page boundary. entity_id ascending breaks every tie deterministically.
        const all = (grainRows ?? [])
            .slice()
            .sort((a, b) => (Number(b.spend_pence ?? 0) - Number(a.spend_pence ?? 0))
                || String(a.entity_id).localeCompare(String(b.entity_id)))
            .map((g) => withCosts(
                { id: g.entity_id, name: g.entity_name ?? null, status: g.entity_status ?? null },
                Number(g.spend_pence ?? 0), Number(g.impressions ?? 0), Number(g.clicks ?? 0),
                sumFunnel(byAd.get(g.entity_id) ?? []),
            ));

        // Cursor is an offset into the spend-sorted list. A tenant with many
        // times this org's ad count must not be rendered in one response.
        const start = cursor ? Number(cursor) : 0;
        const page = all.slice(start, start + PAGE);
        const nextCursor = start + PAGE < all.length ? String(start + PAGE) : null;
        return {
            rows: page, nextCursor,
            effectiveSince: win.effectiveSince, windowClamped: win.windowClamped,
        };
    },
};

export const __test = {
    perUnitPence, ratio, coverageOf, sumFunnel, collapseByCampaign, excludedAccountsOf, funnelUntil,
};
