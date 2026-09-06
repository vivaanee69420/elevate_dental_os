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
// The CPL/CPB/CPA arithmetic, shared with the Google report so the two pages
// cannot drift into two definitions of an acquired patient — see that file's
// header, and migration 000167 for the 8x understatement that forced it.
import {
    ACCEPTANCE_MIN_PAID_PENCE, practiceLeadPerformance,
    campaignLeadPerformance, sumPracticeRows,
} from "../lib/marketing/lead-performance.js";
import { splitByOpenDay } from "../lib/marketing/open-days.js";
import { openDayRepository } from "../repositories/open-day.repository.js";

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
// A cost is unknowable from EITHER end, and both must return null.
//
// Zero units is the obvious one: a cost per nothing cannot be computed.
//
// Zero spend against real units is the dangerous one, and it was returning 0.
// If leads are attributed to advertising, the advertising was paid for — so a
// £0 total beside real leads means the spend rows are ABSENT, not that the
// leads were free. Rendering £0.00 there makes the practice with NO DATA look
// like the practice with the best cost per lead in the group, which is exactly
// inverted from the truth and is the kind of number an owner acts on. Live
// today: Ashford and Barnet have real leads and no Google spend rows since
// their sync lost account access, and both read "£0.00".
//
// (A genuinely paused campaign with a lead from a click just before the window
// lands here too, and null is right for it as well — the cost is real, it just
// falls outside the window being measured.)
function perUnitPence(totalPence, units) {
    const n = Number(units ?? 0);
    if (n <= 0) return null;
    const total = Number(totalPence ?? 0);
    if (total <= 0) return null;
    return Math.round(total / n);
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
// THREE distinct facts can each produce an empty table here:
//
//   1. never_synced       — Meta has never landed a single ad_metrics row for
//                            this org, at ANY grain, ever.
//   2. detail_not_synced   — the campaign tier (ad_metrics) IS populated —
//                            totals are real — but THIS grain's own deep
//                            table (ad_meta_adsets/ad_meta_ads) has never
//                            received a row for this org: the deep sync (a
//                            separate table, separate sync phase from the
//                            campaign pull) simply has not run yet. This used
//                            to be unreachable — the old check only ever
//                            probed ad_metrics, so a populated campaign tier
//                            beside an empty deep table returned
//                            no_spend_in_window, telling the owner "this is
//                            not a sync problem" while ruling out the one
//                            true explanation.
//   3. no_spend_in_window  — both ad_metrics AND this grain's own deep table
//                            have received rows before; there just aren't any
//                            in the requested window/filter.
//
// So probe OUTSIDE the window: has ANY Meta metric row ever landed for this
// org, and (for a deep tier) has THIS grain's own table ever landed one?
// That is the only trustworthy signal — deliberately not
// ad_accounts.period_synced_at, which records that a sync RAN and the window
// it ASKED for, not what came back (migration 000116's header documents a live
// account showing a clean sync through June 2026 with zero metric rows ever).
// Called only on the empty-window path, so the normal path pays nothing.
//
// `table` is the CALLING TIER'S OWN deep-grain table — omitted by
// campaigns(), whose own table already IS ad_metrics, so there is no third
// state to distinguish at that tier.
async function emptyWindowState(orgId, table = null) {
    if (!(await marketingRepository.hasProviderMetrics(orgId, 'meta_ads'))) return 'never_synced';
    if (!table) return 'no_spend_in_window';
    return (await marketingRepository.hasGrainMetrics(orgId, table))
        ? 'no_spend_in_window' : 'detail_not_synced';
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

// The cards' two org-wide reads, cached together for a minute.
//
// Fetched ORG-WIDE and narrowed in JS, so switching practice costs no request.
// The acceptance floor is part of the cache key, not just of the query: it is
// a constant today, but the moment it becomes per-tenant a key without it
// serves one org's rows for another org's threshold, and a wrong `accepted`
// from a warm cache looks exactly like a right one.
const leadPerformanceCache = createTtlCache({ ttlMs: 60_000, max: 300 });

// Campaign-grain Meta spend, folded from campaign x day to campaign and
// reshaped into what campaignLeadPerformance expects. A SECOND cache because
// this one is practice-parameterised and the pair above is not.
const metaCampaignSpendCache = createTtlCache({ ttlMs: 60_000, max: 300 });


export function invalidateMetaLeadPerformanceCache(orgId) {
    const prefix = orgId ? `${orgId}|` : undefined;
    // BOTH caches, always. They are keyed the same way and feed two halves of
    // one payload; clearing only the ledger would leave the per-campaign table
    // computed against a stale spend side while the cards moved.
    leadPerformanceCache.invalidate(prefix);
    metaCampaignSpendCache.invalidate(prefix);
}

async function loadMetaLeadPerformanceData(orgId, since, until) {
    const key = `${orgId}|${since}|${until}|${ACCEPTANCE_MIN_PAID_PENCE}`;
    const hit = leadPerformanceCache.get(key);
    if (hit) return hit;
    return leadPerformanceCache.set(key, await Promise.all([
        marketingRepository.adSpendByPractice(orgId, 'meta_ads', since, until),
        // funnelUntil, not the raw bound: adSpendByPractice is inclusive
        // (metric_date IS a date) while the ledger bounds `< until` (a lead
        // carries a time). Handing the same inclusive date to both drops the
        // last day's leads beside that day's spend — the exact defect this
        // file's header documents finding on the funnel.
        marketingRepository.metaLeadLedger(
            orgId, since, funnelUntil(until), ACCEPTANCE_MIN_PAID_PENCE,
        ),
    ]));
}

async function loadMetaCampaignSpend(orgId, since, until, practiceId) {
    const key = `${orgId}|${since}|${until}|${practiceId ?? ''}`;
    const hit = metaCampaignSpendCache.get(key);
    if (hit) return hit;
    const rows = await marketingRepository.campaignSpendByProvider(
        orgId, since, until, 'meta_ads', null, practiceId,
    );
    const byCampaign = new Map();
    for (const r of rows ?? []) {
        const id = r.campaign_id ?? null;
        if (id == null) continue;
        let row = byCampaign.get(id);
        if (!row) {
            row = {
                entity_id: id, entity_name: r.campaign_name ?? null,
                objective: null, spend_pence: 0, impressions: 0, clicks: 0,
                // Meta's own reported conversions are never requested at this
                // grain, so this stays 0 and the page reads the CRM funnel
                // instead — the same reason the Facebook tabs carry no
                // platform-conversions column below campaign level.
                conversions: 0,
            };
            byCampaign.set(id, row);
        }
        if (!row.entity_name && r.campaign_name) row.entity_name = r.campaign_name;
        row.spend_pence += Number(r.spend_pence ?? 0);
        row.impressions += Number(r.impressions ?? 0);
        row.clicks += Number(r.clicks ?? 0);
    }
    return metaCampaignSpendCache.set(key, [...byCampaign.values()]);
}

export const facebookReportService = {
    // Blended CPL / cost-per-booking / cost-per-accepted-patient — practice
    // grain for the cards, campaign grain for the table beneath them, BOTH
    // derived from ONE ledger call so they cannot disagree.
    //
    // `accepted` here means what it means on the Google report: settled
    // payments attributable to the lead, net of refunds, from the lead's own
    // London day onward, above the consultation floor (migration 000167).
    // The Facebook page previously counted a patient the moment a lead
    // resolved to any Dentally record — measured live for Jun-Aug 2026 that
    // was 267 "patients" against 230 bookings and 33 who had actually paid,
    // so cost per patient read ~8x cheaper than the Google page beside it.
    async leadPerformance(orgId, { since, until, practiceId = null } = {}) {
        const win = clampWindow(since, until);
        // The 92-day clamp exists for the DEEP-GRAIN tables. ad_metrics holds
        // ~15 months, and leads/appointments/payments have no such cap, so
        // these cards take the RAW requested window — the same reasoning as
        // the Google report's leadPerformance. A lead whose ad predates the
        // deep window simply reports a null ad set, which is already the
        // report's explicit "not identified" bucket rather than a loss.
        const rawSince = since ?? win.effectiveSince;
        const rawUntil = until ?? win.until;

        const accounts = await metaAccounts(orgId);
        // An org with no open days mapped gets this shape, and so does one that
        // is not connected at all: zeroed buckets and no events, so the page
        // renders exactly as it did before open days existed.
        const noSplit = () => splitByOpenDay([], [], []);
        // A tenant with nothing else still gets its own coverage figure —
        // zeroed by default (the not_connected path, before anything is
        // fetched), overridden with the real counts once known — never
        // omitted, so the page can always render the "N leads sit in
        // uncategorised pipelines" line.
        const empty = (state, coverage = { uncategorisedLeads: 0, uncategorisedAttributedLeads: 0 }) => ({
            state, practices: [], total: null, practicesAll: [], totalAll: null,
            campaigns: [], campaignsAll: [], leads: [],
            openDays: noSplit(), openDaysAll: noSplit(),
            coverage,
            excludedAccounts: accounts.length ? excludedAccountsOf(accounts) : [],
            acceptanceMinPaidPence: ACCEPTANCE_MIN_PAID_PENCE,
            effectiveSince: rawSince, windowClamped: false,
        });
        if (accounts.length === 0) return empty('not_connected');

        const [[spendRowsAll, ledgerRowsAll], campaignRows, openDayEvents, openDayMappings, uncategorised] =
            await Promise.all([
                loadMetaLeadPerformanceData(orgId, rawSince, rawUntil),
                loadMetaCampaignSpend(orgId, rawSince, rawUntil, practiceId),
                // Read AFTER the not_connected return above: an org with no
                // Meta account has no Meta campaigns to map, so asking is a
                // round trip that can only come back empty.
                openDayRepository.list(orgId),
                openDayRepository.mappings(orgId, 'meta_ads'),
                // Leads Meta CAN see (via the campaign-derived ad_id join) but
                // whose GHL pipeline nobody has put in the channel or open-day
                // map — the honest coverage figure the GHL-pool switch owes,
                // same funnelUntil conversion as the ledger read above it.
                marketingRepository.uncategorisedLeadCounts(orgId, rawSince, funnelUntil(rawUntil)),
            ]);

        // Narrowed in JS from the org-wide pair, so both sides of every ratio
        // are the SAME practice — the asymmetry that once divided a whole
        // group's spend by one practice's leads.
        const spendRows = practiceId ? spendRowsAll.filter((r) => r.practice_id === practiceId) : spendRowsAll;
        const ledgerRows = practiceId ? ledgerRowsAll.filter((r) => r.practice_id === practiceId) : ledgerRowsAll;

        if (spendRows.length === 0 && ledgerRows.length === 0) {
            return empty(await emptyWindowState(orgId), {
                uncategorisedLeads: uncategorised.leads,
                uncategorisedAttributedLeads: uncategorised.attributed,
            });
        }

        const bySpend = (a, b) => b.spendPence - a.spendPence;
        const practices = practiceLeadPerformance(spendRows, ledgerRows, false).sort(bySpend);
        const practicesAll = practiceLeadPerformance(spendRows, ledgerRows, true).sort(bySpend);

        // Unattributed campaigns sort last whatever their spend: the bucket is
        // a statement about coverage, not a campaign competing for budget.
        const byCampaignSpend = (a, b) => (a.attributed === b.attributed
            ? b.spendPence - a.spendPence
            : (a.attributed ? -1 : 1));
        const campaigns = campaignLeadPerformance(campaignRows, ledgerRows, false).sort(byCampaignSpend);
        const campaignsAll = campaignLeadPerformance(campaignRows, ledgerRows, true).sort(byCampaignSpend);

        // --- open days ------------------------------------------------------
        // A campaign absent from this map is always-on; that is the entire
        // definition, which is why "unmapped" needs no storage of its own.
        const eventById = new Map(openDayEvents.map((e) => [e.id, e]));
        const eventByCampaign = new Map();
        for (const m of openDayMappings) {
            const event = eventById.get(m.openDayId);
            if (event) eventByCampaign.set(m.campaignId, event);
        }
        // Which practices ran each event. Taken from the AD ACCOUNT that owns
        // each mapped campaign — "which practices ran this open day" is a
        // question about spend, not about where the leads happened to route.
        // Counted only over campaigns present in THIS window, so a practice
        // filter narrows the count with the numbers beside it rather than
        // claiming three practices next to one practice's figures.
        const practiceByCustomer = new Map(
            accounts.map((a) => [String(a.customer_id), a.practice_id ?? null]),
        );
        const windowCampaignIds = new Set(campaigns.map((c) => c.campaignId).filter(Boolean));
        const practicesByEvent = new Map();
        for (const m of openDayMappings) {
            if (!windowCampaignIds.has(m.campaignId)) continue;
            const practice = practiceByCustomer.get(String(m.customerId));
            if (!practice) continue;
            if (!practicesByEvent.has(m.openDayId)) practicesByEvent.set(m.openDayId, new Set());
            practicesByEvent.get(m.openDayId).add(practice);
        }
        // Spend still comes from the campaign rows above (via eventByCampaign);
        // leads now come from the ledger's own open_day_id — its GHL pipeline,
        // not the campaign it happens to be Meta-attributed to. `includeExisting`
        // is threaded through exactly like campaignLeadPerformance's own
        // boolean above, so the split beneath the cards moves with the
        // "Include existing patients" toggle instead of half-working.
        const splitOf = (campaignRows, rows, includeExisting) => {
            const split = splitByOpenDay(campaignRows, rows, openDayEvents, {
                eventByCampaign, includeExisting,
            });
            return {
                ...split,
                events: split.events.map((e) => ({
                    ...e,
                    practices: practicesByEvent.get(e.openDayId)?.size ?? 0,
                })),
            };
        };

        return {
            state: 'ok',
            practices, total: sumPracticeRows(practices),
            practicesAll, totalAll: sumPracticeRows(practicesAll),
            campaigns, campaignsAll,
            // Always-on vs named events. Spend reconciles to the SAME campaign
            // rows the table above renders; leads reconcile to the SAME
            // ledger rows the cards above are built from — so the page's
            // "= Meta total" identity is arithmetic rather than a second,
            // potentially-drifted computation.
            openDays: splitOf(campaigns, ledgerRows, false),
            openDaysAll: splitOf(campaignsAll, ledgerRows, true),
            // Leads sitting in GHL pipelines nobody has categorised (no
            // channel, no open day) — this tenant's own figure, so the report
            // states what the GHL-pool switch leaves out instead of going
            // quiet about it.
            coverage: {
                uncategorisedLeads: uncategorised.leads,
                uncategorisedAttributedLeads: uncategorised.attributed,
            },
            // The people behind the numbers, so a card click-through lists
            // them without a second, potentially-drifted computation.
            leads: ledgerRows,
            excludedAccounts: excludedAccountsOf(accounts),
            acceptanceMinPaidPence: ACCEPTANCE_MIN_PAID_PENCE,
            effectiveSince: rawSince, windowClamped: false,
        };
    },

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

    async adSets(orgId, { since, until, practiceId = null, campaignId = null } = {}) {
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

        // campaignId is now an OPTIONAL filter: a standalone ad-sets tab calls
        // this with none, and must see every ad set in the window across every
        // campaign. Narrow the funnel to one campaign only when the caller
        // asked for one — filtering on `=== null` here would wrongly keep only
        // the (rare) leads that themselves resolved to no campaign at all.
        const forCampaign = campaignId
            ? (funnelRows ?? []).filter((r) => r.campaign_id === campaignId)
            : (funnelRows ?? []);
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
        // rows + notIdentified + unmatchedLeads reconciles exactly to the
        // campaign tier's row for this campaign when campaignId is given —
        // there is a test pinning that — and to the campaign tier's grand
        // total when it is omitted, since forCampaign is then every funnel
        // row in the window rather than one campaign's.
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
        const state = (grainRows ?? []).length === 0 ? await emptyWindowState(orgId, 'ad_meta_adsets')
            : coverage.leadsTotal > 0 && coverage.leadsWithAdSet === 0 ? 'no_ad_id_coverage' : 'ok';
        return {
            state, coverage, rows, notIdentified, unmatchedLeads,
            effectiveSince: win.effectiveSince, windowClamped: win.windowClamped,
        };
    },

    async ads(orgId, { since, until, practiceId = null, adSetId = null, cursor = null } = {}) {
        const PAGE = 50;
        const win = clampWindow(since, until);
        const accounts = await metaAccounts(orgId);
        if (accounts.length === 0) {
            return {
                state: 'not_connected', rows: [], nextCursor: null,
                effectiveSince: win.effectiveSince, windowClamped: win.windowClamped,
            };
        }

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

        // THIS grain's own state, computed from THIS grain's own rows — not
        // borrowed from campaigns()/adSets(), which read a different table
        // (ad_metrics' campaign-day rows, not the deep-grain ad rollup) and
        // answer a different question. A tenant can be 'ok' at the campaign
        // tier while the ad-level deep-grain sync has nothing for this
        // window, or vice versa; each tier must report what IT actually
        // found.
        //
        // Coverage here is ad_id resolution, not ad_set_id — the question
        // this grain asks is "did a lead resolve down to a specific ad",
        // scoped to the current ad-set filter the same way adSets() scopes
        // its own coverage to campaignId. (ad_meta_funnel derives ad_set_id
        // FROM a lead's ad_id via a join, so ad_set_id present implies ad_id
        // present — but not the reverse — which is why this is its own
        // computation and not a reuse of coverageOf.)
        const forScope = adSetId
            ? (funnelRows ?? []).filter((r) => r.ad_set_id === adSetId)
            : (funnelRows ?? []);
        const leadsTotal = forScope.reduce((n, r) => n + Number(r.leads ?? 0), 0);
        const leadsWithAdId = forScope
            .filter((r) => r.ad_id)
            .reduce((n, r) => n + Number(r.leads ?? 0), 0);

        // Same two guards as campaigns()/adSets(): an empty rollup is not
        // evidence of a missing sync (emptyWindowState probes outside the
        // window before saying so), and zero leads in scope is a quiet
        // window, not a coverage problem — do not drop the leadsTotal > 0
        // check.
        const state = (grainRows ?? []).length === 0 ? await emptyWindowState(orgId, 'ad_meta_ads')
            : leadsTotal > 0 && leadsWithAdId === 0 ? 'no_ad_id_coverage' : 'ok';

        return {
            state, rows: page, nextCursor,
            effectiveSince: win.effectiveSince, windowClamped: win.windowClamped,
        };
    },
};

export const __test = {
    perUnitPence, ratio, coverageOf, sumFunnel, collapseByCampaign, excludedAccountsOf, funnelUntil,
};
