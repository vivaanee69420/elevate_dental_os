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
            spend_pence: 0,
            impressions: 0,
            clicks: 0,
        };
        acc.spend_pence += Number(r.spend_pence ?? 0);
        acc.impressions += Number(r.impressions ?? 0);
        acc.clicks += Number(r.clicks ?? 0);
        if (!acc.campaign_name && r.campaign_name) acc.campaign_name = r.campaign_name;
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

export const facebookReportService = {
    async campaigns(orgId, { since, until, practiceId = null } = {}) {
        const accounts = await metaAccounts(orgId);
        if (accounts.length === 0) {
            return { state: 'not_connected', coverage: null, rows: [], excludedAccounts: [], totals: null, unmatchedLeads: null };
        }
        const excludedAccounts = excludedAccountsOf(accounts);

        const [spendRowsRaw, funnelRows] = await Promise.all([
            marketingRepository.campaignSpendByProvider(orgId, since, until, 'meta_ads'),
            marketingRepository.metaFunnel(orgId, since, until, practiceId),
        ]);

        const spendRows = collapseByCampaign(spendRowsRaw);
        if (spendRows.length === 0) {
            return { state: 'never_synced', coverage: null, rows: [], excludedAccounts, totals: null, unmatchedLeads: null };
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
        return { state, coverage, rows, excludedAccounts, totals, unmatchedLeads };
    },

    async adSets(orgId, campaignId, { since, until, practiceId = null } = {}) {
        const accounts = await metaAccounts(orgId);
        if (accounts.length === 0) {
            return { state: 'not_connected', coverage: null, rows: [], notIdentified: null };
        }

        const [grainRows, funnelRows] = await Promise.all([
            adGrainRepository.rollup(orgId, 'meta_adset', { since, until, practiceId, campaignId }),
            marketingRepository.metaFunnel(orgId, since, until, practiceId),
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

        const rows = (grainRows ?? []).map((g) => ({
            ...withCosts(
                { id: g.entity_id, name: g.entity_name ?? null, status: g.entity_status ?? null },
                Number(g.spend_pence ?? 0), Number(g.impressions ?? 0), Number(g.clicks ?? 0),
                sumFunnel(byAdSet.get(g.entity_id) ?? []),
            ),
            // Reach counts unique PEOPLE, so it is never additive. Carried
            // per ad set and never summed into a total.
            reach: g.reach ?? null,
        }));

        // Leads whose ad set we could not determine. They carry no spend, so
        // they carry no cost either — inventing one would be a fiction.
        const orphan = sumFunnel(forCampaign.filter((r) => !r.ad_set_id));
        const notIdentified = orphan.leads > 0 ? orphan : null;

        // Same guard as campaigns(): zero leads in the window is not evidence
        // of missing ad-id coverage, only a quiet window. Do not drop the
        // leadsTotal > 0 check.
        const state = (grainRows ?? []).length === 0 ? 'never_synced'
            : coverage.leadsTotal > 0 && coverage.leadsWithAdSet === 0 ? 'no_ad_id_coverage' : 'ok';
        return { state, coverage, rows, notIdentified };
    },

    async ads(orgId, adSetId, { since, until, practiceId = null, cursor = null } = {}) {
        const PAGE = 50;
        const [grainRows, funnelRows] = await Promise.all([
            adGrainRepository.rollup(orgId, 'meta_ad', { since, until, practiceId, parentId: adSetId }),
            marketingRepository.metaFunnel(orgId, since, until, practiceId),
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
        return { rows: page, nextCursor };
    },
};

export const __test = { perUnitPence, ratio, coverageOf, sumFunnel, collapseByCampaign, excludedAccountsOf };
