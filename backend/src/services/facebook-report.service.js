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
//     rows. An earlier design keyed a lead's channel off a GoHighLevel-specific
//     field and label pair — a tenant whose CRM names that channel differently
//     would have seen an empty report that looked perfectly healthy.
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
// display. None is assumed — the figures gathered while designing (86%
// ad-id coverage) describe one organisation and must never be hardcoded here.
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
            return { state: 'not_connected', coverage: null, rows: [], excludedAccounts: [], totals: null };
        }
        const excludedAccounts = excludedAccountsOf(accounts);

        const [spendRowsRaw, funnelRows] = await Promise.all([
            marketingRepository.campaignSpendByProvider(orgId, since, until, 'meta_ads'),
            marketingRepository.metaFunnel(orgId, since, until, practiceId),
        ]);

        const spendRows = collapseByCampaign(spendRowsRaw);
        if (spendRows.length === 0) {
            return { state: 'never_synced', coverage: null, rows: [], excludedAccounts, totals: null };
        }

        const coverage = coverageOf(funnelRows ?? []);
        const byCampaign = new Map();
        for (const r of funnelRows ?? []) {
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
            sumFunnel(funnelRows ?? []),
        );

        // A tenant whose CRM sends no ad ids cannot have an ad-set tier. Say so
        // and show the platform metrics, rather than render one useless row.
        const state = coverage.leadsWithAdSet === 0 ? 'no_ad_id_coverage' : 'ok';
        return { state, coverage, rows, excludedAccounts, totals };
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

        const state = (grainRows ?? []).length === 0 ? 'never_synced'
            : coverage.leadsWithAdSet === 0 ? 'no_ad_id_coverage' : 'ok';
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

        const all = (grainRows ?? [])
            .slice()
            .sort((a, b) => Number(b.spend_pence ?? 0) - Number(a.spend_pence ?? 0))
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
