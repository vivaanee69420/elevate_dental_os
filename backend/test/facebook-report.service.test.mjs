// The Facebook report. Its job is to be honest for ANY tenant: the figures
// gathered while designing describe one organisation, and another tenant may
// have zero ad-id coverage, a non-GBP account, or none of Meta connected at
// all.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { londonDaysAgo, londonYmd } from '../src/lib/tz.js';

vi.mock('../src/repositories/marketing.repository.js', () => ({
    marketingRepository: {
        metaFunnel: vi.fn(),
        campaignSpendByProvider: vi.fn(),
        adAccountsForProvider: vi.fn(),
    },
}));
vi.mock('../src/repositories/ad-grain.repository.js', () => ({
    GRAINS: ['meta_adset', 'meta_ad', 'google_adgroup', 'google_ad', 'google_keyword'],
    adGrainRepository: { rollup: vi.fn() },
}));

const { facebookReportService } = await import('../src/services/facebook-report.service.js');
const { marketingRepository } = await import('../src/repositories/marketing.repository.js');
const { adGrainRepository } = await import('../src/repositories/ad-grain.repository.js');
// The SAME constant the service clamps against — see google-ads-deep-sync.js.
// Not hardcoded here so this test never drifts from the service's own floor.
const { DEEP_WINDOW_DAYS } = await import('../src/lib/integrations/google-ads-deep-sync.js');

const ORG = '11111111-1111-1111-1111-111111111111';
// since is derived from the SAME floor the service clamps against, not a
// literal date. A hardcoded 'since' sits still while DEEP_WINDOW_DAYS's floor
// moves with the clock, so it eventually falls below the floor and every test
// using WIN would silently start exercising only the clamped path (which is
// exactly what happened here once before — see the dedicated clamp tests
// below, which own that branch on purpose). Deriving it keeps WIN inside the
// floor forever, so these ~20 tests keep covering the unclamped pass-through.
const WIN = { since: londonDaysAgo(DEEP_WINDOW_DAYS - 10), until: '2026-08-31', practiceId: null };

beforeEach(() => {
    // adAccountsForProvider(orgId, 'meta_ads') is already provider-scoped —
    // an empty array IS "no Meta account", with no extra filtering needed.
    marketingRepository.adAccountsForProvider.mockResolvedValue([
        { customer_id: 'act1', name: 'Acct', currency: 'GBP', status: 'ACTIVE' },
    ]);
    marketingRepository.campaignSpendByProvider.mockResolvedValue([
        { campaign_id: 'CMP1', campaign_name: 'Implants', spend_pence: 100000, impressions: 5000, clicks: 250 },
    ]);
    marketingRepository.metaFunnel.mockResolvedValue([
        { campaign_id: 'CMP1', ad_set_id: 'AS1', ad_id: 'AD1', practice_id: null,
          leads: 10, booked: 4, attended: 2, patients: 2, new_patients: 1 },
    ]);
    adGrainRepository.rollup.mockResolvedValue([]);
});

// SPEC-LEVEL: the deep-grain tables (adGrainRepository.rollup) hold only a
// rolling DEEP_WINDOW_DAYS window while ad_metrics/the funnel cover roughly
// fifteen months. A caller asking for a year must not get campaign costs
// computed over a year of spend/leads while the ad-set tier silently divides
// 92 days of spend by a year of leads — the funnel window and the deep-grain
// window must always agree. clampWindow() is the single place that decides
// the window every downstream call actually uses.
describe('window clamping', () => {
    it('clamps a since before the deep-grain floor across all three methods, and every repository call receives the CLAMPED since — not the raw one', async () => {
        const floor = londonDaysAgo(DEEP_WINDOW_DAYS);
        const tooEarly = londonDaysAgo(DEEP_WINDOW_DAYS + 30);   // 30 days before the floor
        const until = londonYmd();

        const campOut = await facebookReportService.campaigns(ORG, { since: tooEarly, until, practiceId: null });
        expect(campOut.effectiveSince).toBe(floor);
        expect(campOut.windowClamped).toBe(true);

        const adSetOut = await facebookReportService.adSets(ORG, 'CMP1', { since: tooEarly, until, practiceId: null });
        expect(adSetOut.effectiveSince).toBe(floor);
        expect(adSetOut.windowClamped).toBe(true);

        const adsOut = await facebookReportService.ads(ORG, 'AS1', { since: tooEarly, until, practiceId: null });
        expect(adsOut.effectiveSince).toBe(floor);
        expect(adsOut.windowClamped).toBe(true);

        // The payload could be right while a call underneath still used the
        // raw value — assert directly on what each repository was actually
        // called with, not just on what the service reported back.
        expect(marketingRepository.metaFunnel.mock.calls.length).toBeGreaterThan(0);
        for (const c of marketingRepository.metaFunnel.mock.calls) expect(c[1]).toBe(floor);
        expect(marketingRepository.campaignSpendByProvider.mock.calls.length).toBeGreaterThan(0);
        for (const c of marketingRepository.campaignSpendByProvider.mock.calls) expect(c[1]).toBe(floor);
        expect(adGrainRepository.rollup.mock.calls.length).toBeGreaterThan(0);
        for (const c of adGrainRepository.rollup.mock.calls) expect(c[2].since).toBe(floor);
    });

    it('passes a since inside the floor through untouched', async () => {
        const withinFloor = londonDaysAgo(DEEP_WINDOW_DAYS - 10);
        const until = londonYmd();
        const out = await facebookReportService.campaigns(ORG, { since: withinFloor, until, practiceId: null });
        expect(out.effectiveSince).toBe(withinFloor);
        expect(out.windowClamped).toBe(false);
        for (const c of marketingRepository.metaFunnel.mock.calls) expect(c[1]).toBe(withinFloor);
    });

    // Asking for nothing is not the same as asking for too much: an omitted
    // since defaults to the floor but is not reported as a clamp.
    it('defaults an omitted since to the floor, without reporting it as clamped', async () => {
        const floor = londonDaysAgo(DEEP_WINDOW_DAYS);
        const out = await facebookReportService.campaigns(ORG, { practiceId: null });
        expect(out.effectiveSince).toBe(floor);
        expect(out.windowClamped).toBe(false);
    });

    it('carries effectiveSince and windowClamped on the not_connected early return', async () => {
        marketingRepository.adAccountsForProvider.mockResolvedValue([]);
        const out = await facebookReportService.campaigns(ORG, WIN);
        expect(out.state).toBe('not_connected');
        expect(out).toHaveProperty('effectiveSince');
        expect(out).toHaveProperty('windowClamped');
    });

    it('carries effectiveSince and windowClamped on the never_synced early return', async () => {
        marketingRepository.campaignSpendByProvider.mockResolvedValue([]);
        const out = await facebookReportService.campaigns(ORG, WIN);
        expect(out.state).toBe('never_synced');
        expect(out).toHaveProperty('effectiveSince');
        expect(out).toHaveProperty('windowClamped');
    });
});

describe('multi-tenant states', () => {
    it('reports not_connected when the org has no Meta ad account', async () => {
        marketingRepository.adAccountsForProvider.mockResolvedValue([]);
        const out = await facebookReportService.campaigns(ORG, WIN);
        expect(out.state).toBe('not_connected');
        expect(out.rows).toEqual([]);
        expect(out.excludedAccounts).toEqual([]);
    });

    it('reports never_synced when Meta is connected but no deep rows exist', async () => {
        marketingRepository.campaignSpendByProvider.mockResolvedValue([]);
        adGrainRepository.rollup.mockResolvedValue([]);
        const out = await facebookReportService.campaigns(ORG, WIN);
        expect(out.state).toBe('never_synced');
    });

    // A tenant whose GoHighLevel never sends ad_id must not get a report whose
    // only row explains a problem. Platform metrics, and a stated reason.
    it('reports no_ad_id_coverage when no lead resolves to an ad', async () => {
        marketingRepository.metaFunnel.mockResolvedValue([
            { campaign_id: 'CMP1', ad_set_id: null, ad_id: null, practice_id: null,
              leads: 40, booked: 0, attended: 0, patients: 0, new_patients: 0 },
        ]);
        const out = await facebookReportService.campaigns(ORG, WIN);
        expect(out.state).toBe('no_ad_id_coverage');
        expect(out.coverage).toEqual({ leadsTotal: 40, leadsWithAdSet: 0, pct: 0 });
        expect(out.rows[0].spendPence).toBe(100000);   // platform metrics still shown
    });

    it('reports ok and each tenant its OWN coverage figure', async () => {
        marketingRepository.metaFunnel.mockResolvedValue([
            { campaign_id: 'CMP1', ad_set_id: 'AS1', ad_id: 'AD1', practice_id: null,
              leads: 30, booked: 0, attended: 0, patients: 0, new_patients: 0 },
            { campaign_id: 'CMP1', ad_set_id: null, ad_id: null, practice_id: null,
              leads: 10, booked: 0, attended: 0, patients: 0, new_patients: 0 },
        ]);
        const out = await facebookReportService.campaigns(ORG, WIN);
        expect(out.state).toBe('ok');
        expect(out.coverage).toEqual({ leadsTotal: 40, leadsWithAdSet: 30, pct: 75 });
        expect(out.excludedAccounts).toEqual([]);
    });

    // CRITICAL: leadsWithAdSet === 0 is ALSO true on a quiet week with zero
    // leads, which is not the same fact as "leads exist but none resolve to
    // an ad". A tenant with Meta connected, real synced spend, and simply no
    // leads this window must not be told their CRM has a coverage problem.
    it('reports ok, not no_ad_id_coverage, when there are simply no leads in the window', async () => {
        marketingRepository.metaFunnel.mockResolvedValue([]);
        const out = await facebookReportService.campaigns(ORG, WIN);
        expect(out.state).toBe('ok');
        expect(out.coverage).toEqual({ leadsTotal: 0, leadsWithAdSet: 0, pct: 0 });
    });
});

describe('derived costs', () => {
    it('divides spend by the funnel counts', async () => {
        const out = await facebookReportService.campaigns(ORG, WIN);
        const row = out.rows.find((r) => r.id === 'CMP1');
        expect(row.leads).toBe(10);
        expect(row.cplPence).toBe(10000);   // 100000 / 10
        expect(row.cpbPence).toBe(25000);   // 100000 / 4
        expect(row.cpaPence).toBe(50000);   // 100000 / 2
    });

    // A cost per nothing is unknowable, not free. 0 here would read as
    // "this campaign acquires patients for free".
    it('returns null, not 0, on a zero denominator', async () => {
        marketingRepository.metaFunnel.mockResolvedValue([
            { campaign_id: 'CMP1', ad_set_id: 'AS1', ad_id: 'AD1', practice_id: null,
              leads: 0, booked: 0, attended: 0, patients: 0, new_patients: 0 },
        ]);
        const out = await facebookReportService.campaigns(ORG, WIN);
        const row = out.rows.find((r) => r.id === 'CMP1');
        expect(row.cplPence).toBeNull();
        expect(row.cpbPence).toBeNull();
        expect(row.cpaPence).toBeNull();
    });

    it('returns null CTR and CPC when there were no impressions or clicks', async () => {
        marketingRepository.campaignSpendByProvider.mockResolvedValue([
            { campaign_id: 'CMP1', campaign_name: 'X', spend_pence: 5000, impressions: 0, clicks: 0 },
        ]);
        const out = await facebookReportService.campaigns(ORG, WIN);
        const row = out.rows.find((r) => r.id === 'CMP1');
        expect(row.ctr).toBeNull();
        expect(row.cpcPence).toBeNull();
    });
});

// RULING A: ad_metrics is campaign x DAY. campaignSpendByProvider returns one
// row per campaign per day, never one row per campaign — the service must
// collapse them itself before a "campaign row" means anything.
describe('campaign spend collapsing (campaign x day -> campaign)', () => {
    it('sums several day-rows for the same campaign into one row', async () => {
        marketingRepository.campaignSpendByProvider.mockResolvedValue([
            { campaign_id: 'CMP1', campaign_name: 'Implants', spend_pence: 60000, impressions: 3000, clicks: 150 },
            { campaign_id: 'CMP1', campaign_name: 'Implants', spend_pence: 40000, impressions: 2000, clicks: 100 },
        ]);
        const out = await facebookReportService.campaigns(ORG, WIN);
        expect(out.rows).toHaveLength(1);
        const row = out.rows[0];
        expect(row.id).toBe('CMP1');
        expect(row.name).toBe('Implants');
        expect(row.spendPence).toBe(100000);
        expect(row.impressions).toBe(5000);
        expect(row.clicks).toBe(250);
    });

    it('keeps separate campaigns separate while collapsing each one', async () => {
        marketingRepository.campaignSpendByProvider.mockResolvedValue([
            { campaign_id: 'CMP1', campaign_name: 'Implants', spend_pence: 10000, impressions: 500, clicks: 25 },
            { campaign_id: 'CMP1', campaign_name: 'Implants', spend_pence: 10000, impressions: 500, clicks: 25 },
            { campaign_id: 'CMP2', campaign_name: 'Whitening', spend_pence: 5000, impressions: 200, clicks: 10 },
        ]);
        const out = await facebookReportService.campaigns(ORG, WIN);
        expect(out.rows.map((r) => r.id).sort()).toEqual(['CMP1', 'CMP2']);
        expect(out.rows.find((r) => r.id === 'CMP1').spendPence).toBe(20000);
        expect(out.rows.find((r) => r.id === 'CMP2').spendPence).toBe(5000);
    });
});

// RULING B: adAccounts() does not select currency, and a blanket [] for
// excludedAccounts silently drops the non-GBP tenant state. Use
// adAccountsForProvider (which does carry currency) and the same currency
// guard the sync itself uses.
describe('excluded accounts', () => {
    it('surfaces a non-GBP Meta account in excludedAccounts, using the sync\'s own currency guard', async () => {
        marketingRepository.adAccountsForProvider.mockResolvedValue([
            { customer_id: 'act1', name: 'Acct', currency: 'GBP', status: 'ACTIVE' },
            { customer_id: 'act2', name: 'US Account', currency: 'USD', status: 'ACTIVE' },
        ]);
        const out = await facebookReportService.campaigns(ORG, WIN);
        expect(out.excludedAccounts).toEqual([
            { customerId: 'act2', name: 'US Account', currency: 'USD', reason: 'unsupported_currency' },
        ]);
    });

    it('does not exclude an account with a null/absent currency (treated as GBP)', async () => {
        marketingRepository.adAccountsForProvider.mockResolvedValue([
            { customer_id: 'act1', name: 'Acct', currency: null, status: 'ACTIVE' },
        ]);
        const out = await facebookReportService.campaigns(ORG, WIN);
        expect(out.excludedAccounts).toEqual([]);
    });
});

// IMPORTANT: ad_meta_funnel's Meta restriction is NOT date-scoped (provider
// identity isn't a windowed question), while campaignSpendByProvider IS. So a
// campaign that spent outside this window but produced a lead inside it
// shows up in the funnel with no matching spend row here — its leads must
// not inflate totals.leads while contributing nothing to totals.spendPence,
// which would silently UNDERSTATE every cost-per-X figure.
describe('campaign totals and coverage scope to campaigns with spend in this window', () => {
    it('totals.leads equals the sum of rows[].leads; an orphan funnel row lands in unmatchedLeads instead', async () => {
        // CMP1 has a spend row (from beforeEach). CMP2 has a funnel row (a
        // lead inside this window) but no spend row here at all.
        marketingRepository.metaFunnel.mockResolvedValue([
            { campaign_id: 'CMP1', ad_set_id: 'AS1', ad_id: 'AD1', practice_id: null,
              leads: 10, booked: 4, attended: 2, patients: 2, new_patients: 1 },
            { campaign_id: 'CMP2', ad_set_id: 'AS9', ad_id: 'AD9', practice_id: null,
              leads: 7, booked: 2, attended: 1, patients: 1, new_patients: 1 },
        ]);
        const out = await facebookReportService.campaigns(ORG, WIN);
        const rowsLeadsSum = out.rows.reduce((n, r) => n + r.leads, 0);
        expect(out.totals.leads).toBe(rowsLeadsSum);
        expect(out.totals.leads).toBe(10);   // CMP2's 7 must NOT be folded in
        expect(out.unmatchedLeads).toEqual({ leads: 7, booked: 2, attended: 1, patients: 1, newPatients: 1 });
    });

    it('returns unmatchedLeads: null when every funnel row matches a campaign with spend in this window', async () => {
        const out = await facebookReportService.campaigns(ORG, WIN);
        expect(out.unmatchedLeads).toBeNull();
    });

    it('coverage excludes leads whose campaign has no spend row in this window', async () => {
        marketingRepository.metaFunnel.mockResolvedValue([
            { campaign_id: 'CMP1', ad_set_id: 'AS1', ad_id: 'AD1', practice_id: null,
              leads: 10, booked: 4, attended: 2, patients: 2, new_patients: 1 },
            // CMP2 is not in spendRows — a huge unmatched lead count must not
            // move coverage at all, in either direction.
            { campaign_id: 'CMP2', ad_set_id: null, ad_id: null, practice_id: null,
              leads: 100, booked: 0, attended: 0, patients: 0, new_patients: 0 },
        ]);
        const out = await facebookReportService.campaigns(ORG, WIN);
        expect(out.coverage).toEqual({ leadsTotal: 10, leadsWithAdSet: 10, pct: 100 });
    });
});

describe('ad sets', () => {
    // Same guard as campaigns(): a quiet window with zero leads for this
    // campaign is not evidence of missing ad-id coverage.
    it('reports ok, not no_ad_id_coverage, when there are simply no leads for this campaign', async () => {
        adGrainRepository.rollup.mockResolvedValue([
            { entity_id: 'AS1', entity_name: 'Photos 35+', parent_id: 'CMP1',
              campaign_id: 'CMP1', entity_status: null,
              spend_pence: 60000, impressions: 3000, clicks: 150, conversions: 0 },
        ]);
        marketingRepository.metaFunnel.mockResolvedValue([]);
        const out = await facebookReportService.adSets(ORG, 'CMP1', WIN);
        expect(out.state).toBe('ok');
        expect(out.coverage).toEqual({ leadsTotal: 0, leadsWithAdSet: 0, pct: 0 });
    });

    it('separates the unidentified bucket from real ad sets', async () => {
        adGrainRepository.rollup.mockResolvedValue([
            { entity_id: 'AS1', entity_name: 'Photos 35+', parent_id: 'CMP1',
              campaign_id: 'CMP1', entity_status: null,
              spend_pence: 60000, impressions: 3000, clicks: 150, conversions: 0 },
        ]);
        marketingRepository.metaFunnel.mockResolvedValue([
            { campaign_id: 'CMP1', ad_set_id: 'AS1', ad_id: 'AD1', practice_id: null,
              leads: 6, booked: 3, attended: 1, patients: 1, new_patients: 1 },
            { campaign_id: 'CMP1', ad_set_id: null, ad_id: null, practice_id: null,
              leads: 4, booked: 1, attended: 0, patients: 0, new_patients: 0 },
        ]);
        const out = await facebookReportService.adSets(ORG, 'CMP1', WIN);
        expect(out.rows.map((r) => r.id)).toEqual(['AS1']);
        // Leads we could not place: counted, but never given spend or a cost.
        expect(out.notIdentified).toEqual({ leads: 4, booked: 1, attended: 0, patients: 0, newPatients: 0 });
    });

    it('omits the unidentified bucket entirely when coverage is complete', async () => {
        const out = await facebookReportService.adSets(ORG, 'CMP1', WIN);
        expect(out.notIdentified).toBeNull();
    });
});

// IMPORTANT: ads() had no tests at all, and its cursor paging rests on the
// sort order being a TOTAL order. Spend descending alone leaves ties (several
// zero-spend ads is a normal shape for a small practice) broken by whatever
// order adGrainRepository.rollup happened to return — not guaranteed stable
// across two calls, which paging depends on to avoid skipping/repeating rows.
describe('ads() paging', () => {
    function grainRow(id, spendPence) {
        return {
            entity_id: id, entity_name: `Ad ${id}`, parent_id: 'AS1',
            campaign_id: 'CMP1', entity_status: 'ACTIVE',
            spend_pence: spendPence, impressions: 100, clicks: 5, conversions: 0,
        };
    }

    it('returns at most PAGE (50) rows with a nextCursor when more remain', async () => {
        const rows = Array.from({ length: 120 }, (_, i) => grainRow(`AD${String(i).padStart(3, '0')}`, 1000 - i));
        adGrainRepository.rollup.mockResolvedValue(rows);
        const out = await facebookReportService.ads(ORG, 'AS1', WIN);
        expect(out.rows).toHaveLength(50);
        expect(out.nextCursor).toBe('50');
    });

    it('pages through with no overlap and no gap, ending on nextCursor: null', async () => {
        const rows = Array.from({ length: 120 }, (_, i) => grainRow(`AD${String(i).padStart(3, '0')}`, 1000 - i));
        adGrainRepository.rollup.mockResolvedValue(rows);

        const page1 = await facebookReportService.ads(ORG, 'AS1', WIN);
        const page2 = await facebookReportService.ads(ORG, 'AS1', { ...WIN, cursor: page1.nextCursor });
        const page3 = await facebookReportService.ads(ORG, 'AS1', { ...WIN, cursor: page2.nextCursor });

        const ids1 = page1.rows.map((r) => r.id);
        const ids2 = page2.rows.map((r) => r.id);
        const ids3 = page3.rows.map((r) => r.id);

        expect(ids1).toHaveLength(50);
        expect(ids2).toHaveLength(50);
        expect(ids3).toHaveLength(20);
        expect(page3.nextCursor).toBeNull();

        expect(ids1.filter((id) => ids2.includes(id) || ids3.includes(id))).toEqual([]);
        expect(ids2.filter((id) => ids3.includes(id))).toEqual([]);
        expect(new Set([...ids1, ...ids2, ...ids3]).size).toBe(120);
    });

    it('breaks spend ties on entity_id so equal-spend ads come back in a stable, repeatable order', async () => {
        // All zero spend — order depends entirely on the tiebreaker, not on
        // whatever order the mocked repository call happens to return.
        const rows = [
            grainRow('AD_Z', 0), grainRow('AD_A', 0), grainRow('AD_M', 0),
            grainRow('AD_B', 0), grainRow('AD_Y', 0),
        ];
        adGrainRepository.rollup.mockResolvedValue(rows);

        const out1 = await facebookReportService.ads(ORG, 'AS1', WIN);
        const out2 = await facebookReportService.ads(ORG, 'AS1', WIN);

        expect(out1.rows.map((r) => r.id)).toEqual(['AD_A', 'AD_B', 'AD_M', 'AD_Y', 'AD_Z']);
        expect(out2.rows.map((r) => r.id)).toEqual(out1.rows.map((r) => r.id));
    });
});

describe('tenant isolation', () => {
    it('never reads without an organisation id', async () => {
        await facebookReportService.campaigns(ORG, WIN);
        for (const c of marketingRepository.adAccountsForProvider.mock.calls) expect(c[0]).toBe(ORG);
        for (const c of marketingRepository.metaFunnel.mock.calls) expect(c[0]).toBe(ORG);
        for (const c of marketingRepository.campaignSpendByProvider.mock.calls) expect(c[0]).toBe(ORG);
        for (const c of adGrainRepository.rollup.mock.calls) expect(c[0]).toBe(ORG);
    });

    // M2: a CRM's own labels must never decide what counts as a Meta lead.
    // This greps the STRIPPED source (block + line comments removed) so the
    // header comment is free to name the two historical strings in prose —
    // documenting what must never come back is not the same as reintroducing
    // it. Patterns are case-insensitive and tolerant of the separator being
    // absent (camelCase), an underscore, or a space, so a reintroduction as
    // `PaidSocial`, `Attribution_Source` or `attributionSource` still trips
    // it. This proves the two HISTORICAL strings never reappear in live
    // code — it is not proof against every possible way of gating on a CRM's
    // own vocabulary; the structural join (ad_meta_funnel resolving ad_id
    // itself) is what actually guarantees that.
    it("never gates on GoHighLevel's attribution_source / \"Paid Social\" vocabulary", async () => {
        const { readFileSync } = await import('node:fs');
        const raw = readFileSync('src/services/facebook-report.service.js', 'utf8');
        const stripped = raw
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^\s*\/\/.*$/gm, '');
        expect(stripped).not.toMatch(/paid[_\s]?social/i);
        expect(stripped).not.toMatch(/attribution[_\s]?source/i);
    });
});
