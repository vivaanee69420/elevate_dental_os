// The Google report. Campaign -> Ad Group -> { Ads, Keywords }: ads and
// keywords are SIBLINGS under an ad group, which is why there are four
// methods here where facebook-report.service.test.mjs covers three. Google
// reports conversions at every grain (Meta does not), so every row here
// carries a real cost-per-conversion from Google's own tracking — never a CRM
// funnel, and never CPL/CPB/CPA (those need CallRail+GHL dedup, a separate
// plan). Mirrors facebook-report.service.test.mjs's fixtures/structure.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { londonDaysAgo, londonYmd } from '../src/lib/tz.js';

vi.mock('../src/repositories/marketing.repository.js', () => ({
    marketingRepository: {
        campaignSpendByProvider: vi.fn(),
        adAccountsForProvider: vi.fn(),
        hasProviderMetrics: vi.fn(),
        hasGrainMetrics: vi.fn(),
    },
}));
vi.mock('../src/repositories/ad-grain.repository.js', () => ({
    GRAINS: ['meta_adset', 'meta_ad', 'google_adgroup', 'google_ad', 'google_keyword'],
    adGrainRepository: { rollup: vi.fn(), keywordRollup: vi.fn() },
}));

const { googleReportService, __test } = await import('../src/services/google-report.service.js');
const { marketingRepository } = await import('../src/repositories/marketing.repository.js');
const { adGrainRepository } = await import('../src/repositories/ad-grain.repository.js');
// The SAME constant/clamp the service uses — see google-ads-deep-sync.js and
// google-report.service.js's import of clampWindow from
// facebook-report.service.js. Not hardcoded so this test never drifts.
const { DEEP_WINDOW_DAYS } = await import('../src/lib/integrations/google-ads-deep-sync.js');

const ORG = '11111111-1111-1111-1111-111111111111';
const WIN = { since: londonDaysAgo(DEEP_WINDOW_DAYS - 10), until: '2026-08-31', practiceId: null };

beforeEach(() => {
    vi.clearAllMocks();
    // Default: this org HAS synced Google before, at both campaign grain AND
    // this deep tier, so an empty window is a quiet window, not a missing
    // sync or unsynced detail. Tests that mean "never synced" or
    // "detail_not_synced" say so.
    marketingRepository.hasProviderMetrics.mockResolvedValue(true);
    marketingRepository.hasGrainMetrics.mockResolvedValue(true);
    marketingRepository.adAccountsForProvider.mockResolvedValue([
        { customer_id: 'act1', name: 'Acct', currency: 'GBP', status: 'ACTIVE' },
    ]);
    marketingRepository.campaignSpendByProvider.mockResolvedValue([
        { campaign_id: 'CMP1', campaign_name: 'Implants', campaign_status: 'ACTIVE', metric_date: '2026-08-15',
          spend_pence: 100000, impressions: 5000, clicks: 250, conversions: 12.5 },
    ]);
    adGrainRepository.rollup.mockResolvedValue([]);
    adGrainRepository.keywordRollup.mockResolvedValue([]);
});

function adGroupRow(overrides = {}) {
    return {
        entity_id: 'AG1', entity_name: 'Implants UK', parent_id: 'CMP1',
        campaign_id: 'CMP1', campaign_name: 'Implants', entity_status: 'ENABLED',
        spend_pence: 60000, impressions: 3000, clicks: 150, conversions: 6,
        ...overrides,
    };
}

function adRow(overrides = {}) {
    return {
        entity_id: 'AD1', entity_name: 'Ad one', parent_id: 'AG1',
        campaign_id: 'CMP1', campaign_name: 'Implants', entity_status: 'ENABLED',
        spend_pence: 3000, impressions: 100, clicks: 5, conversions: 1,
        ...overrides,
    };
}

function keywordRow(overrides = {}) {
    return {
        entity_id: 'KW1', entity_name: 'dental implants', parent_id: 'AG1',
        campaign_id: 'CMP1', campaign_name: 'Implants', entity_status: 'ENABLED',
        spend_pence: 2000, impressions: 400, clicks: 20, conversions: 2,
        match_type: 'EXACT', quality_score: 7,
        search_impression_share: 0.62, search_top_impression_share: 0.4,
        search_absolute_top_impression_share: 0.1,
        ...overrides,
    };
}

// ===========================================================================
// Window clamping — same clampWindow, same floor, imported (not re-derived)
// from facebook-report.service.js.
// ===========================================================================
describe('window clamping', () => {
    it('clamps a since before the deep-grain floor across all four methods, and every repository call receives the CLAMPED since', async () => {
        const floor = londonDaysAgo(DEEP_WINDOW_DAYS);
        const tooEarly = londonDaysAgo(DEEP_WINDOW_DAYS + 30);
        const until = londonYmd();
        adGrainRepository.rollup.mockResolvedValue([adGroupRow()]);
        adGrainRepository.keywordRollup.mockResolvedValue([keywordRow()]);

        const campOut = await googleReportService.campaigns(ORG, { since: tooEarly, until, practiceId: null });
        expect(campOut.effectiveSince).toBe(floor);
        expect(campOut.windowClamped).toBe(true);

        const agOut = await googleReportService.adGroups(ORG, { since: tooEarly, until, practiceId: null });
        expect(agOut.effectiveSince).toBe(floor);
        expect(agOut.windowClamped).toBe(true);

        const adsOut = await googleReportService.ads(ORG, { since: tooEarly, until, practiceId: null });
        expect(adsOut.effectiveSince).toBe(floor);
        expect(adsOut.windowClamped).toBe(true);

        const kwOut = await googleReportService.keywords(ORG, { since: tooEarly, until, practiceId: null });
        expect(kwOut.effectiveSince).toBe(floor);
        expect(kwOut.windowClamped).toBe(true);

        expect(marketingRepository.campaignSpendByProvider.mock.calls.length).toBeGreaterThan(0);
        for (const c of marketingRepository.campaignSpendByProvider.mock.calls) expect(c[1]).toBe(floor);
        expect(adGrainRepository.rollup.mock.calls.length).toBeGreaterThan(0);
        for (const c of adGrainRepository.rollup.mock.calls) expect(c[2].since).toBe(floor);
        expect(adGrainRepository.keywordRollup.mock.calls.length).toBeGreaterThan(0);
        for (const c of adGrainRepository.keywordRollup.mock.calls) expect(c[1].since).toBe(floor);
    });

    it('passes a since inside the floor through untouched', async () => {
        const withinFloor = londonDaysAgo(DEEP_WINDOW_DAYS - 10);
        const until = londonYmd();
        const out = await googleReportService.campaigns(ORG, { since: withinFloor, until, practiceId: null });
        expect(out.effectiveSince).toBe(withinFloor);
        expect(out.windowClamped).toBe(false);
    });

    it('defaults an omitted since to the floor without reporting it as clamped', async () => {
        const floor = londonDaysAgo(DEEP_WINDOW_DAYS);
        const out = await googleReportService.campaigns(ORG, { practiceId: null });
        expect(out.effectiveSince).toBe(floor);
        expect(out.windowClamped).toBe(false);
    });

    it('carries effectiveSince and windowClamped on the not_connected early return, for all four methods', async () => {
        marketingRepository.adAccountsForProvider.mockResolvedValue([]);
        for (const method of ['campaigns', 'adGroups', 'ads', 'keywords']) {
            const out = await googleReportService[method](ORG, WIN);
            expect(out.state).toBe('not_connected');
            expect(out).toHaveProperty('effectiveSince');
            expect(out).toHaveProperty('windowClamped');
        }
    });

    it('carries effectiveSince and windowClamped on the empty-window early return', async () => {
        marketingRepository.campaignSpendByProvider.mockResolvedValue([]);
        marketingRepository.hasProviderMetrics.mockResolvedValue(false);
        const out = await googleReportService.campaigns(ORG, WIN);
        expect(out.state).toBe('never_synced');
        expect(out).toHaveProperty('effectiveSince');
        expect(out).toHaveProperty('windowClamped');
    });
});

// ===========================================================================
// Multi-tenant states — every one of the four methods returns its OWN state.
// facebook-report.service.js's ads() currently returns none at all (a known,
// separately-tracked gap); that gap must not be reproduced here.
// ===========================================================================
describe('multi-tenant states', () => {
    it('reports not_connected on all four methods when the org has no Google ad account', async () => {
        marketingRepository.adAccountsForProvider.mockResolvedValue([]);
        for (const method of ['campaigns', 'adGroups', 'ads', 'keywords']) {
            const out = await googleReportService[method](ORG, WIN);
            expect(out.state).toBe('not_connected');
            expect(out.rows).toEqual([]);
            expect(out.excludedAccounts).toEqual([]);
        }
    });

    it('reports never_synced only when NO google_ads metric row has ever landed for the org — campaigns', async () => {
        marketingRepository.campaignSpendByProvider.mockResolvedValue([]);
        marketingRepository.hasProviderMetrics.mockResolvedValue(false);
        const out = await googleReportService.campaigns(ORG, WIN);
        expect(out.state).toBe('never_synced');
        expect(marketingRepository.hasProviderMetrics).toHaveBeenCalledWith(ORG, 'google_ads');
    });

    it('reports no_spend_in_window, not never_synced, for a synced tenant whose window is simply empty — campaigns', async () => {
        marketingRepository.campaignSpendByProvider.mockResolvedValue([]);
        marketingRepository.hasProviderMetrics.mockResolvedValue(true);
        const out = await googleReportService.campaigns(ORG, WIN);
        expect(out.state).toBe('no_spend_in_window');
    });

    it('applies the same never_synced / no_spend_in_window distinction at ad-group, ad and keyword grain, when the deep table has synced before', async () => {
        adGrainRepository.rollup.mockResolvedValue([]);
        adGrainRepository.keywordRollup.mockResolvedValue([]);

        // This grain's OWN deep table has landed a row before (just none in
        // this window) — so an empty campaign-grain probe still wins.
        marketingRepository.hasProviderMetrics.mockResolvedValue(true);
        marketingRepository.hasGrainMetrics.mockResolvedValue(true);
        expect((await googleReportService.adGroups(ORG, WIN)).state).toBe('no_spend_in_window');
        expect((await googleReportService.ads(ORG, WIN)).state).toBe('no_spend_in_window');
        expect((await googleReportService.keywords(ORG, WIN)).state).toBe('no_spend_in_window');

        // Google Ads has NEVER synced for this org at all — never_synced wins
        // regardless of hasGrainMetrics (which the tri-state never even
        // needs to consult in that case).
        marketingRepository.hasProviderMetrics.mockResolvedValue(false);
        expect((await googleReportService.adGroups(ORG, WIN)).state).toBe('never_synced');
        expect((await googleReportService.ads(ORG, WIN)).state).toBe('never_synced');
        expect((await googleReportService.keywords(ORG, WIN)).state).toBe('never_synced');
    });

    // ===========================================================================
    // MAJOR 2: detail_not_synced — the campaign tier (ad_metrics) IS
    // populated for this org, but THIS grain's own deep table has never
    // received a row. Before this fix emptyWindowState only ever probed
    // ad_metrics, so this exact case returned no_spend_in_window — "this is
    // not a sync problem, there is simply no spend" — while ruling out the
    // one true explanation (the deep sync has not run yet). These tests
    // FAIL without the fix: they'd see 'no_spend_in_window' instead.
    // ===========================================================================
    describe('detail_not_synced: campaign totals real, this grain never synced', () => {
        it('reports detail_not_synced at ad-group grain, NOT no_spend_in_window, when ad_metrics has rows but ad_google_adgroups never has', async () => {
            adGrainRepository.rollup.mockResolvedValue([]);
            marketingRepository.hasProviderMetrics.mockResolvedValue(true);
            marketingRepository.hasGrainMetrics.mockResolvedValue(false);
            const out = await googleReportService.adGroups(ORG, WIN);
            expect(out.state).toBe('detail_not_synced');
            expect(marketingRepository.hasGrainMetrics).toHaveBeenCalledWith(ORG, 'ad_google_adgroups');
        });

        it('reports detail_not_synced at ad grain against ad_google_ads', async () => {
            adGrainRepository.rollup.mockResolvedValue([]);
            marketingRepository.hasProviderMetrics.mockResolvedValue(true);
            marketingRepository.hasGrainMetrics.mockResolvedValue(false);
            const out = await googleReportService.ads(ORG, WIN);
            expect(out.state).toBe('detail_not_synced');
            expect(marketingRepository.hasGrainMetrics).toHaveBeenCalledWith(ORG, 'ad_google_ads');
        });

        it('reports detail_not_synced at keyword grain against ad_google_keywords', async () => {
            adGrainRepository.keywordRollup.mockResolvedValue([]);
            marketingRepository.hasProviderMetrics.mockResolvedValue(true);
            marketingRepository.hasGrainMetrics.mockResolvedValue(false);
            const out = await googleReportService.keywords(ORG, WIN);
            expect(out.state).toBe('detail_not_synced');
            expect(marketingRepository.hasGrainMetrics).toHaveBeenCalledWith(ORG, 'ad_google_keywords');
        });

        it('campaigns() has no third state — it IS campaign grain, so an empty window is never_synced/no_spend_in_window only', async () => {
            marketingRepository.campaignSpendByProvider.mockResolvedValue([]);
            marketingRepository.hasProviderMetrics.mockResolvedValue(true);
            const out = await googleReportService.campaigns(ORG, WIN);
            expect(out.state).toBe('no_spend_in_window');
            // campaigns() must never consult hasGrainMetrics at all — it has
            // no deep table of its own to distinguish.
            expect(marketingRepository.hasGrainMetrics).not.toHaveBeenCalled();
        });
    });

    it('reports ok at every grain when rows are present', async () => {
        adGrainRepository.rollup.mockResolvedValue([adGroupRow()]);
        adGrainRepository.keywordRollup.mockResolvedValue([keywordRow()]);
        expect((await googleReportService.campaigns(ORG, WIN)).state).toBe('ok');
        expect((await googleReportService.adGroups(ORG, WIN)).state).toBe('ok');
        expect((await googleReportService.ads(ORG, WIN)).state).toBe('ok');
        expect((await googleReportService.keywords(ORG, WIN)).state).toBe('ok');
    });
});

// ===========================================================================
// Conversions and cost-per-conversion — the deliberate difference from the
// Facebook page. Present at every grain, numeric (not coerced to an int),
// and null (not 0) on a zero denominator.
// ===========================================================================
describe('conversions and cost-per-conversion, at every grain', () => {
    it('campaign grain: divides spend by conversions', async () => {
        const out = await googleReportService.campaigns(ORG, WIN);
        const row = out.rows.find((r) => r.id === 'CMP1');
        expect(row.conversions).toBe(12.5);
        expect(row.costPerConversionPence).toBe(8000);   // 100000 / 12.5
    });

    it('ad-group grain: carries conversions and cost-per-conversion', async () => {
        adGrainRepository.rollup.mockResolvedValue([adGroupRow({ spend_pence: 60000, conversions: 6 })]);
        const out = await googleReportService.adGroups(ORG, WIN);
        const row = out.rows[0];
        expect(row.conversions).toBe(6);
        expect(row.costPerConversionPence).toBe(10000);   // 60000 / 6
    });

    it('ad grain: carries conversions and cost-per-conversion', async () => {
        adGrainRepository.rollup.mockResolvedValue([adRow({ spend_pence: 3000, conversions: 1 })]);
        const out = await googleReportService.ads(ORG, WIN);
        const row = out.rows[0];
        expect(row.conversions).toBe(1);
        expect(row.costPerConversionPence).toBe(3000);
    });

    it('keyword grain: carries conversions and cost-per-conversion', async () => {
        adGrainRepository.keywordRollup.mockResolvedValue([keywordRow({ spend_pence: 2000, conversions: 2 })]);
        const out = await googleReportService.keywords(ORG, WIN);
        const row = out.rows[0];
        expect(row.conversions).toBe(2);
        expect(row.costPerConversionPence).toBe(1000);
    });

    it('returns costPerConversionPence: null, not 0, at zero conversions — every grain', async () => {
        marketingRepository.campaignSpendByProvider.mockResolvedValue([
            { campaign_id: 'CMP1', campaign_name: 'Implants', campaign_status: 'ACTIVE', metric_date: '2026-08-15',
              spend_pence: 100000, impressions: 5000, clicks: 250, conversions: 0 },
        ]);
        adGrainRepository.rollup.mockResolvedValue([adGroupRow({ conversions: 0 }), adRow({ conversions: 0 })]);
        adGrainRepository.keywordRollup.mockResolvedValue([keywordRow({ conversions: 0 })]);

        expect((await googleReportService.campaigns(ORG, WIN)).rows[0].costPerConversionPence).toBeNull();
        expect((await googleReportService.adGroups(ORG, WIN)).rows[0].costPerConversionPence).toBeNull();
        expect((await googleReportService.ads(ORG, WIN)).rows[0].costPerConversionPence).toBeNull();
        expect((await googleReportService.keywords(ORG, WIN)).rows[0].costPerConversionPence).toBeNull();
    });

    // conversions is NUMERIC (modelled, fractional), never coerced to an
    // integer. A parseInt-style implementation would silently floor 12.5 -> 12
    // and drift from Google's own reported figure.
    it('preserves a fractional conversions value untouched, not truncated', async () => {
        adGrainRepository.rollup.mockResolvedValue([adGroupRow({ spend_pence: 1000, conversions: 3.7 })]);
        const out = await googleReportService.adGroups(ORG, WIN);
        expect(out.rows[0].conversions).toBe(3.7);
    });

    // PostgREST commonly serialises a SQL numeric as a JSON STRING to avoid
    // precision loss (same reason ad_meta_funnel's leads/booked need Number()
    // in marketing.repository.js). A raw string must still divide correctly,
    // not string-concatenate or become NaN.
    it('coerces a string-serialised numeric conversions value correctly', async () => {
        adGrainRepository.keywordRollup.mockResolvedValue([keywordRow({ spend_pence: 1000, conversions: '2.5' })]);
        const out = await googleReportService.keywords(ORG, WIN);
        expect(out.rows[0].conversions).toBe(2.5);
        expect(out.rows[0].costPerConversionPence).toBe(400);   // 1000 / 2.5
    });

    it('returns null CTR and CPC when there were no impressions or clicks', async () => {
        adGrainRepository.rollup.mockResolvedValue([adGroupRow({ impressions: 0, clicks: 0 })]);
        const out = await googleReportService.adGroups(ORG, WIN);
        expect(out.rows[0].ctr).toBeNull();
        expect(out.rows[0].cpcPence).toBeNull();
    });
});

// ===========================================================================
// No funnel-shaped columns anywhere: no coverage, no leads/booked/attended/
// patients, no CPL/CPB/CPA. Google's rows are already fully attributed by the
// platform itself.
// ===========================================================================
describe('no CRM-funnel shape on any Google tab', () => {
    it('campaign rows carry no coverage/leads/cplPence fields', async () => {
        const out = await googleReportService.campaigns(ORG, WIN);
        expect(out).not.toHaveProperty('coverage');
        expect(out).not.toHaveProperty('unmatchedLeads');
        const row = out.rows[0];
        for (const key of ['leads', 'booked', 'attended', 'patients', 'newPatients', 'cplPence', 'cpbPence', 'cpaPence']) {
            expect(row).not.toHaveProperty(key);
        }
    });

    it('ad-group/ad/keyword responses carry no notIdentified/unmatchedLeads buckets', async () => {
        adGrainRepository.rollup.mockResolvedValue([adGroupRow()]);
        adGrainRepository.keywordRollup.mockResolvedValue([keywordRow()]);
        for (const method of ['adGroups', 'ads', 'keywords']) {
            const out = await googleReportService[method](ORG, WIN);
            expect(out).not.toHaveProperty('notIdentified');
            expect(out).not.toHaveProperty('unmatchedLeads');
            expect(out).not.toHaveProperty('coverage');
        }
    });
});

// RULING A analogue — campaign spend collapsing (campaign x day -> campaign),
// summing conversions alongside spend/impressions/clicks.
describe('campaign spend collapsing (campaign x day -> campaign)', () => {
    it('sums several day-rows for the same campaign into one row, conversions included', async () => {
        marketingRepository.campaignSpendByProvider.mockResolvedValue([
            { campaign_id: 'CMP1', campaign_name: 'Implants', campaign_status: 'ACTIVE', metric_date: '2026-08-01',
              spend_pence: 60000, impressions: 3000, clicks: 150, conversions: 4 },
            { campaign_id: 'CMP1', campaign_name: 'Implants', campaign_status: 'ACTIVE', metric_date: '2026-08-02',
              spend_pence: 40000, impressions: 2000, clicks: 100, conversions: 3.5 },
        ]);
        const out = await googleReportService.campaigns(ORG, WIN);
        expect(out.rows).toHaveLength(1);
        const row = out.rows[0];
        expect(row.spendPence).toBe(100000);
        expect(row.impressions).toBe(5000);
        expect(row.clicks).toBe(250);
        expect(row.conversions).toBe(7.5);
    });

    it('keeps separate campaigns separate while collapsing each one', async () => {
        marketingRepository.campaignSpendByProvider.mockResolvedValue([
            { campaign_id: 'CMP1', campaign_name: 'Implants', spend_pence: 10000, impressions: 500, clicks: 25, conversions: 1 },
            { campaign_id: 'CMP1', campaign_name: 'Implants', spend_pence: 10000, impressions: 500, clicks: 25, conversions: 1 },
            { campaign_id: 'CMP2', campaign_name: 'Whitening', spend_pence: 5000, impressions: 200, clicks: 10, conversions: 2 },
        ]);
        const out = await googleReportService.campaigns(ORG, WIN);
        expect(out.rows.map((r) => r.id).sort()).toEqual(['CMP1', 'CMP2']);
        expect(out.rows.find((r) => r.id === 'CMP1').conversions).toBe(2);
        expect(out.rows.find((r) => r.id === 'CMP2').conversions).toBe(2);
    });

    it('takes campaign status from the LATEST day, not row order', async () => {
        marketingRepository.campaignSpendByProvider.mockResolvedValue([
            { campaign_id: 'CMP1', campaign_name: 'Implants', campaign_status: 'PAUSED',
              metric_date: '2026-08-20', spend_pence: 40000, impressions: 2000, clicks: 100, conversions: 1 },
            { campaign_id: 'CMP1', campaign_name: 'Implants', campaign_status: 'ENABLED',
              metric_date: '2026-08-01', spend_pence: 60000, impressions: 3000, clicks: 150, conversions: 2 },
        ]);
        const out = await googleReportService.campaigns(ORG, WIN);
        expect(out.rows[0].status).toBe('PAUSED');
        expect(out.rows[0].spendPence).toBe(100000);
    });

    it('does not leak the internal status-date accumulator into a row', async () => {
        const out = await googleReportService.campaigns(ORG, WIN);
        expect(out.rows[0]).not.toHaveProperty('_statusDate');
    });
});

// campaigns() totals — same shape as facebook-report.service.js's, but
// derived from Google's own conversions rather than a funnel.
describe('campaign totals', () => {
    it('sums rows into a null-identity totals row, conversions included', async () => {
        marketingRepository.campaignSpendByProvider.mockResolvedValue([
            { campaign_id: 'CMP1', campaign_name: 'Implants', spend_pence: 60000, impressions: 3000, clicks: 150, conversions: 4 },
            { campaign_id: 'CMP2', campaign_name: 'Whitening', spend_pence: 5000, impressions: 200, clicks: 10, conversions: 2 },
        ]);
        const out = await googleReportService.campaigns(ORG, WIN);
        expect(out.totals.id).toBeNull();
        expect(out.totals.name).toBeNull();
        expect(out.totals.spendPence).toBe(65000);
        expect(out.totals.conversions).toBe(6);
        expect(out.totals.costPerConversionPence).toBe(Math.round(65000 / 6));
    });

    it('adGroups/ads/keywords carry no totals field — same shape as Facebook adSets/ads', async () => {
        adGrainRepository.rollup.mockResolvedValue([adGroupRow()]);
        adGrainRepository.keywordRollup.mockResolvedValue([keywordRow()]);
        expect(await googleReportService.adGroups(ORG, WIN)).not.toHaveProperty('totals');
        expect(await googleReportService.ads(ORG, WIN)).not.toHaveProperty('totals');
        expect(await googleReportService.keywords(ORG, WIN)).not.toHaveProperty('totals');
    });
});

// RULING B analogue — excluded (non-GBP) accounts.
describe('excluded accounts', () => {
    it('surfaces a non-GBP Google account in excludedAccounts, using the sync\'s own currency guard', async () => {
        marketingRepository.adAccountsForProvider.mockResolvedValue([
            { customer_id: 'act1', name: 'Acct', currency: 'GBP', status: 'ACTIVE' },
            { customer_id: 'act2', name: 'US Account', currency: 'USD', status: 'ACTIVE' },
        ]);
        const out = await googleReportService.campaigns(ORG, WIN);
        expect(out.excludedAccounts).toEqual([
            { customerId: 'act2', name: 'US Account', currency: 'USD', reason: 'unsupported_currency' },
        ]);
    });

    it('does not exclude an account with a null/absent currency (treated as GBP)', async () => {
        marketingRepository.adAccountsForProvider.mockResolvedValue([
            { customer_id: 'act1', name: 'Acct', currency: null, status: 'ACTIVE' },
        ]);
        const out = await googleReportService.campaigns(ORG, WIN);
        expect(out.excludedAccounts).toEqual([]);
    });

    it('is wired identically at every grain', async () => {
        marketingRepository.adAccountsForProvider.mockResolvedValue([
            { customer_id: 'act1', name: 'Acct', currency: 'GBP', status: 'ACTIVE' },
            { customer_id: 'act2', name: 'US Account', currency: 'USD', status: 'ACTIVE' },
        ]);
        adGrainRepository.rollup.mockResolvedValue([adGroupRow()]);
        adGrainRepository.keywordRollup.mockResolvedValue([keywordRow()]);
        for (const method of ['adGroups', 'ads', 'keywords']) {
            const out = await googleReportService[method](ORG, WIN);
            expect(out.excludedAccounts).toEqual([
                { customerId: 'act2', name: 'US Account', currency: 'USD', reason: 'unsupported_currency' },
            ]);
        }
    });
});

// ===========================================================================
// Parent filter absent/present, at each grain.
// ===========================================================================
describe('adGroups(): campaignId is an optional filter', () => {
    it('with no campaignId returns every ad group in the window, across campaigns', async () => {
        adGrainRepository.rollup.mockResolvedValue([
            adGroupRow({ entity_id: 'AG1', campaign_id: 'CMP1' }),
            adGroupRow({ entity_id: 'AG2', campaign_id: 'CMP2', campaign_name: 'Whitening' }),
        ]);
        const out = await googleReportService.adGroups(ORG, WIN);
        expect(out.rows.map((r) => r.id).sort()).toEqual(['AG1', 'AG2']);
        expect(adGrainRepository.rollup).toHaveBeenCalledWith(
            ORG, 'google_adgroup', expect.objectContaining({ campaignId: null }),
        );
    });

    it('with a campaignId narrows to that campaign only', async () => {
        adGrainRepository.rollup.mockResolvedValue([adGroupRow({ entity_id: 'AG1', campaign_id: 'CMP1' })]);
        const out = await googleReportService.adGroups(ORG, { ...WIN, campaignId: 'CMP1' });
        expect(adGrainRepository.rollup).toHaveBeenCalledWith(
            ORG, 'google_adgroup', expect.objectContaining({ campaignId: 'CMP1' }),
        );
        expect(out.rows.map((r) => r.id)).toEqual(['AG1']);
    });

    it('carries campaignId/campaignName on each row so an unfiltered listing is still readable', async () => {
        adGrainRepository.rollup.mockResolvedValue([adGroupRow({ campaign_id: 'CMP1', campaign_name: 'Implants' })]);
        const out = await googleReportService.adGroups(ORG, WIN);
        expect(out.rows[0].campaignId).toBe('CMP1');
        expect(out.rows[0].campaignName).toBe('Implants');
    });
});

describe('ads(): campaignId and parentId (ad group id) are both optional filters', () => {
    it('with neither filter returns every ad in the window, across ad groups', async () => {
        adGrainRepository.rollup.mockResolvedValue([
            adRow({ entity_id: 'AD1', parent_id: 'AG1' }),
            adRow({ entity_id: 'AD2', parent_id: 'AG2' }),
        ]);
        const out = await googleReportService.ads(ORG, WIN);
        expect(out.rows.map((r) => r.id).sort()).toEqual(['AD1', 'AD2']);
        expect(adGrainRepository.rollup).toHaveBeenCalledWith(
            ORG, 'google_ad', expect.objectContaining({ campaignId: null, parentId: null }),
        );
    });

    it('with a parentId narrows to that ad group\'s ads only', async () => {
        adGrainRepository.rollup.mockResolvedValue([adRow({ entity_id: 'AD1', parent_id: 'AG1' })]);
        const out = await googleReportService.ads(ORG, { ...WIN, parentId: 'AG1' });
        expect(adGrainRepository.rollup).toHaveBeenCalledWith(
            ORG, 'google_ad', expect.objectContaining({ parentId: 'AG1' }),
        );
        expect(out.rows.map((r) => r.id)).toEqual(['AD1']);
    });

    it('with a campaignId (and no parentId) narrows to that campaign\'s ads across ad groups', async () => {
        adGrainRepository.rollup.mockResolvedValue([adRow({ entity_id: 'AD1' })]);
        await googleReportService.ads(ORG, { ...WIN, campaignId: 'CMP1' });
        expect(adGrainRepository.rollup).toHaveBeenCalledWith(
            ORG, 'google_ad', expect.objectContaining({ campaignId: 'CMP1', parentId: null }),
        );
    });

    it('carries campaignId/campaignName/parentId on each row', async () => {
        adGrainRepository.rollup.mockResolvedValue([adRow({ campaign_id: 'CMP1', campaign_name: 'Implants', parent_id: 'AG1' })]);
        const out = await googleReportService.ads(ORG, WIN);
        expect(out.rows[0]).toMatchObject({ campaignId: 'CMP1', campaignName: 'Implants', parentId: 'AG1' });
    });
});

describe('keywords(): campaignId and parentId (ad group id) are both optional filters — the SIBLING of ads()', () => {
    it('with neither filter returns every keyword in the window, across ad groups', async () => {
        adGrainRepository.keywordRollup.mockResolvedValue([
            keywordRow({ entity_id: 'KW1', parent_id: 'AG1' }),
            keywordRow({ entity_id: 'KW2', parent_id: 'AG2' }),
        ]);
        const out = await googleReportService.keywords(ORG, WIN);
        expect(out.rows.map((r) => r.id).sort()).toEqual(['KW1', 'KW2']);
        expect(adGrainRepository.keywordRollup).toHaveBeenCalledWith(
            ORG, expect.objectContaining({ campaignId: null, parentId: null }),
        );
    });

    it('with a parentId narrows to that ad group\'s keywords only', async () => {
        adGrainRepository.keywordRollup.mockResolvedValue([keywordRow({ entity_id: 'KW1', parent_id: 'AG1' })]);
        const out = await googleReportService.keywords(ORG, { ...WIN, parentId: 'AG1' });
        expect(adGrainRepository.keywordRollup).toHaveBeenCalledWith(
            ORG, expect.objectContaining({ parentId: 'AG1' }),
        );
        expect(out.rows.map((r) => r.id)).toEqual(['KW1']);
    });

    it('with a campaignId (and no parentId) narrows to that campaign\'s keywords across ad groups', async () => {
        adGrainRepository.keywordRollup.mockResolvedValue([keywordRow({ entity_id: 'KW1' })]);
        await googleReportService.keywords(ORG, { ...WIN, campaignId: 'CMP1' });
        expect(adGrainRepository.keywordRollup).toHaveBeenCalledWith(
            ORG, expect.objectContaining({ campaignId: 'CMP1', parentId: null }),
        );
    });
});

// ===========================================================================
// MINOR 5: ads() and keywords() rows carry the parent AD GROUP's name, not
// just the campaign's. ad_grain_rollup groups by (entity_id, parent_id), and
// Google reuses a keyword's criterion id across ad groups, so an unfiltered
// listing can legitimately render the same entity_id under the SAME campaign
// several times with different numbers — only the ad group disambiguates
// them, and campaignName alone could not.
// ===========================================================================
describe('ads()/keywords(): parent ad group name (MINOR 5)', () => {
    it('ads(): attaches the parent ad group name, resolved from the google_adgroup grain', async () => {
        adGrainRepository.rollup.mockImplementation(async (_orgId, grain) => {
            if (grain === 'google_ad') return [adRow({ parent_id: 'AG1' })];
            if (grain === 'google_adgroup') return [adGroupRow({ entity_id: 'AG1', entity_name: 'Implants UK' })];
            return [];
        });
        const out = await googleReportService.ads(ORG, WIN);
        expect(out.rows[0].parentId).toBe('AG1');
        expect(out.rows[0].parentName).toBe('Implants UK');
    });

    it('ads(): parentName is null, not undefined/absent, when it cannot be resolved', async () => {
        adGrainRepository.rollup.mockImplementation(async (_orgId, grain) => {
            if (grain === 'google_ad') return [adRow({ parent_id: 'AG_UNKNOWN' })];
            if (grain === 'google_adgroup') return [adGroupRow({ entity_id: 'AG1' })];
            return [];
        });
        const out = await googleReportService.ads(ORG, WIN);
        expect(out.rows[0].parentName).toBeNull();
    });

    it('keywords(): disambiguates the SAME keyword reused across two ad groups by parentName', async () => {
        adGrainRepository.keywordRollup.mockResolvedValue([
            keywordRow({ entity_id: 'KW1', parent_id: 'AG1' }),
            keywordRow({ entity_id: 'KW1', parent_id: 'AG2' }),
        ]);
        adGrainRepository.rollup.mockImplementation(async (_orgId, grain) => (grain === 'google_adgroup' ? [
            adGroupRow({ entity_id: 'AG1', entity_name: 'Implants UK' }),
            adGroupRow({ entity_id: 'AG2', entity_name: 'Implants US' }),
        ] : []));
        const out = await googleReportService.keywords(ORG, WIN);
        const byParent = Object.fromEntries(out.rows.map((r) => [r.parentId, r.parentName]));
        expect(byParent).toEqual({ AG1: 'Implants UK', AG2: 'Implants US' });
    });

    // The empty-window path must not pay for a lookup it will never render —
    // parentAdGroupNames is called AFTER the empty-grainRows early return.
    it('does not query ad-group names on the empty-window path', async () => {
        adGrainRepository.rollup.mockResolvedValue([]);
        await googleReportService.ads(ORG, WIN);
        expect(adGrainRepository.rollup).toHaveBeenCalledTimes(1);
        expect(adGrainRepository.rollup).toHaveBeenCalledWith(ORG, 'google_ad', expect.anything());
    });

    // The ad-group name lookup takes practiceId/campaignId, NEVER the
    // ad/keyword-tier `parentId` argument: on the 'google_adgroup' grain,
    // parent_id means an ad group's own PARENT (its campaign) — passing an ad
    // GROUP id through as if it meant the same thing would filter by an id
    // that matches no campaign and silently return zero ad-group names.
    it('passes practiceId/campaignId (never the ad-tier parentId) to the ad-group name lookup', async () => {
        adGrainRepository.rollup.mockImplementation(async (_orgId, grain) => (
            grain === 'google_ad' ? [adRow({ parent_id: 'AG1' })] : [adGroupRow({ entity_id: 'AG1' })]
        ));
        await googleReportService.ads(ORG, { ...WIN, campaignId: 'CMP1', parentId: 'AG1' });
        const groupCall = adGrainRepository.rollup.mock.calls.find((c) => c[1] === 'google_adgroup');
        expect(groupCall[2]).toMatchObject({ campaignId: 'CMP1' });
        expect(groupCall[2].parentId ?? null).toBeNull();
    });
});

// ===========================================================================
// Keyword-only fields: match type, Quality Score, the three impression-share
// figures — plus the approximate note.
// ===========================================================================
describe('keyword-only fields', () => {
    it('carries match type, Quality Score and the three impression-share figures', async () => {
        adGrainRepository.keywordRollup.mockResolvedValue([keywordRow({
            match_type: 'PHRASE', quality_score: 8,
            search_impression_share: 0.55, search_top_impression_share: 0.3,
            search_absolute_top_impression_share: 0.05,
        })]);
        const out = await googleReportService.keywords(ORG, WIN);
        const row = out.rows[0];
        expect(row.matchType).toBe('PHRASE');
        expect(row.qualityScore).toBe(8);
        expect(row.searchImpressionShare).toBe(0.55);
        expect(row.searchTopImpressionShare).toBe(0.3);
        expect(row.searchAbsoluteTopImpressionShare).toBe(0.05);
    });

    it('leaves Quality Score and impression share null, not 0, when the feed carries none', async () => {
        adGrainRepository.keywordRollup.mockResolvedValue([keywordRow({
            quality_score: null, search_impression_share: null,
            search_top_impression_share: null, search_absolute_top_impression_share: null,
        })]);
        const out = await googleReportService.keywords(ORG, WIN);
        const row = out.rows[0];
        expect(row.qualityScore).toBeNull();
        expect(row.searchImpressionShare).toBeNull();
        expect(row.searchTopImpressionShare).toBeNull();
        expect(row.searchAbsoluteTopImpressionShare).toBeNull();
    });

    // PostgREST commonly serialises a SQL numeric as a JSON string.
    it('coerces string-serialised Quality Score / impression share values', async () => {
        adGrainRepository.keywordRollup.mockResolvedValue([keywordRow({
            quality_score: '7', search_impression_share: '0.42',
        })]);
        const out = await googleReportService.keywords(ORG, WIN);
        expect(out.rows[0].qualityScore).toBe(7);
        expect(out.rows[0].searchImpressionShare).toBe(0.42);
    });

    it('carries an approximate note on every keywords() response, stating the two approximations', async () => {
        for (const setup of [
            () => marketingRepository.adAccountsForProvider.mockResolvedValue([]),   // not_connected
            () => { marketingRepository.hasProviderMetrics.mockResolvedValue(false); adGrainRepository.keywordRollup.mockResolvedValue([]); },   // never_synced
            () => adGrainRepository.keywordRollup.mockResolvedValue([keywordRow()]),   // ok
        ]) {
            vi.clearAllMocks();
            marketingRepository.hasProviderMetrics.mockResolvedValue(true);
            marketingRepository.adAccountsForProvider.mockResolvedValue([
                { customer_id: 'act1', name: 'Acct', currency: 'GBP', status: 'ACTIVE' },
            ]);
            adGrainRepository.keywordRollup.mockResolvedValue([]);
            setup();
            const out = await googleReportService.keywords(ORG, WIN);
            expect(out.approximate.impressionShare).toMatch(/impression-weighted average/i);
            expect(out.approximate.qualityScore).toMatch(/latest value/i);
            expect(out.approximate.qualityScore).toMatch(/not an average/i);
        }
    });

    it('carries no approximate note on campaigns/adGroups/ads — only keywords needs one', async () => {
        adGrainRepository.rollup.mockResolvedValue([adGroupRow()]);
        expect(await googleReportService.campaigns(ORG, WIN)).not.toHaveProperty('approximate');
        expect(await googleReportService.adGroups(ORG, WIN)).not.toHaveProperty('approximate');
        expect(await googleReportService.ads(ORG, WIN)).not.toHaveProperty('approximate');
    });
});

// ===========================================================================
// ads()/keywords() cursor paging — the SIBLING leaves, both paged the same
// way as facebook-report.service.js's ads(): spend descending, entity_id
// ascending tiebreak (a total order, so paging across calls is stable).
// ===========================================================================
describe('ads() and keywords() cursor paging', () => {
    function rows(build, n) {
        return Array.from({ length: n }, (_, i) => build({
            entity_id: `E${String(i).padStart(3, '0')}`, spend_pence: 1000 - i,
        }));
    }

    it('ads(): returns at most PAGE (50) rows with a nextCursor when more remain', async () => {
        adGrainRepository.rollup.mockResolvedValue(rows(adRow, 120));
        const out = await googleReportService.ads(ORG, WIN);
        expect(out.rows).toHaveLength(50);
        expect(out.nextCursor).toBe('50');
    });

    it('ads(): pages through with no overlap and no gap, ending on nextCursor: null', async () => {
        adGrainRepository.rollup.mockResolvedValue(rows(adRow, 120));
        const page1 = await googleReportService.ads(ORG, WIN);
        const page2 = await googleReportService.ads(ORG, { ...WIN, cursor: page1.nextCursor });
        const page3 = await googleReportService.ads(ORG, { ...WIN, cursor: page2.nextCursor });
        const ids = [page1, page2, page3].map((p) => p.rows.map((r) => r.id));
        expect(ids[0]).toHaveLength(50);
        expect(ids[1]).toHaveLength(50);
        expect(ids[2]).toHaveLength(20);
        expect(page3.nextCursor).toBeNull();
        expect(new Set(ids.flat()).size).toBe(120);
    });

    it('ads(): breaks spend ties on entity_id so equal-spend ads come back stable', async () => {
        adGrainRepository.rollup.mockResolvedValue([
            adRow({ entity_id: 'AD_Z', spend_pence: 0 }), adRow({ entity_id: 'AD_A', spend_pence: 0 }),
            adRow({ entity_id: 'AD_M', spend_pence: 0 }),
        ]);
        const out1 = await googleReportService.ads(ORG, WIN);
        const out2 = await googleReportService.ads(ORG, WIN);
        expect(out1.rows.map((r) => r.id)).toEqual(['AD_A', 'AD_M', 'AD_Z']);
        expect(out2.rows.map((r) => r.id)).toEqual(out1.rows.map((r) => r.id));
    });

    it('keywords(): returns at most PAGE (50) rows with a nextCursor when more remain', async () => {
        adGrainRepository.keywordRollup.mockResolvedValue(rows(keywordRow, 120));
        const out = await googleReportService.keywords(ORG, WIN);
        expect(out.rows).toHaveLength(50);
        expect(out.nextCursor).toBe('50');
    });

    it('keywords(): pages through with no overlap and no gap, ending on nextCursor: null', async () => {
        adGrainRepository.keywordRollup.mockResolvedValue(rows(keywordRow, 130));
        const page1 = await googleReportService.keywords(ORG, WIN);
        const page2 = await googleReportService.keywords(ORG, { ...WIN, cursor: page1.nextCursor });
        const page3 = await googleReportService.keywords(ORG, { ...WIN, cursor: page2.nextCursor });
        const ids = [page1, page2, page3].map((p) => p.rows.map((r) => r.id));
        expect(ids[0]).toHaveLength(50);
        expect(ids[1]).toHaveLength(50);
        expect(ids[2]).toHaveLength(30);
        expect(page3.nextCursor).toBeNull();
        expect(new Set(ids.flat()).size).toBe(130);
    });

    it('adGroups() and campaigns() are NOT paged — no cursor/nextCursor on their shape', async () => {
        adGrainRepository.rollup.mockResolvedValue([adGroupRow()]);
        const ag = await googleReportService.adGroups(ORG, WIN);
        expect(ag).not.toHaveProperty('nextCursor');
        const camp = await googleReportService.campaigns(ORG, WIN);
        expect(camp).not.toHaveProperty('nextCursor');
    });
});

// ===========================================================================
// Tenant isolation.
// ===========================================================================
describe('tenant isolation', () => {
    it('never reads without an organisation id, across all four methods', async () => {
        adGrainRepository.rollup.mockResolvedValue([adGroupRow()]);
        adGrainRepository.keywordRollup.mockResolvedValue([keywordRow()]);
        await googleReportService.campaigns(ORG, WIN);
        await googleReportService.adGroups(ORG, WIN);
        await googleReportService.ads(ORG, WIN);
        await googleReportService.keywords(ORG, WIN);

        for (const c of marketingRepository.adAccountsForProvider.mock.calls) expect(c[0]).toBe(ORG);
        for (const c of marketingRepository.campaignSpendByProvider.mock.calls) expect(c[0]).toBe(ORG);
        for (const c of adGrainRepository.rollup.mock.calls) expect(c[0]).toBe(ORG);
        for (const c of adGrainRepository.keywordRollup.mock.calls) expect(c[0]).toBe(ORG);
    });

    // orgId is only ever the first positional argument; an organisation-shaped
    // field smuggled into the options object must be inert. Same guard as
    // facebook-report.service.test.mjs's identical test.
    it('ignores any organisation-shaped field inside the options object', async () => {
        adGrainRepository.rollup.mockResolvedValue([adGroupRow()]);
        adGrainRepository.keywordRollup.mockResolvedValue([keywordRow()]);
        const spoofed = { ...WIN, organisation_id: 'evil-org', organisationId: 'evil-org' };
        await googleReportService.campaigns(ORG, spoofed);
        await googleReportService.adGroups(ORG, spoofed);
        await googleReportService.ads(ORG, spoofed);
        await googleReportService.keywords(ORG, spoofed);

        for (const c of marketingRepository.adAccountsForProvider.mock.calls) expect(c[0]).toBe(ORG);
        for (const c of marketingRepository.campaignSpendByProvider.mock.calls) expect(c[0]).toBe(ORG);
        for (const c of adGrainRepository.rollup.mock.calls) expect(c[0]).toBe(ORG);
        for (const c of adGrainRepository.keywordRollup.mock.calls) expect(c[0]).toBe(ORG);
    });

    it('never returns another org\'s ad groups when listing unfiltered', async () => {
        const OTHER_ORG = '99999999-9999-9999-9999-999999999999';
        adGrainRepository.rollup.mockImplementation(async (orgId) => (
            orgId === ORG
                ? [adGroupRow({ entity_id: 'AG_MINE' })]
                : [adGroupRow({ entity_id: 'AG_THEIRS' })]
        ));
        const mine = await googleReportService.adGroups(ORG, WIN);
        expect(mine.rows.map((r) => r.id)).toEqual(['AG_MINE']);

        const theirs = await googleReportService.adGroups(OTHER_ORG, WIN);
        expect(theirs.rows.map((r) => r.id)).toEqual(['AG_THEIRS']);
    });

    it('never returns another org\'s keywords when listing unfiltered', async () => {
        const OTHER_ORG = '99999999-9999-9999-9999-999999999999';
        adGrainRepository.keywordRollup.mockImplementation(async (orgId) => (
            orgId === ORG
                ? [keywordRow({ entity_id: 'KW_MINE' })]
                : [keywordRow({ entity_id: 'KW_THEIRS' })]
        ));
        const mine = await googleReportService.keywords(ORG, WIN);
        expect(mine.rows.map((r) => r.id)).toEqual(['KW_MINE']);

        const theirs = await googleReportService.keywords(OTHER_ORG, WIN);
        expect(theirs.rows.map((r) => r.id)).toEqual(['KW_THEIRS']);
    });
});

// Internal helpers, exercised directly (mirrors facebook-report.service.test.mjs's __test coverage).
describe('__test helpers', () => {
    it('perUnitPence divides, and returns null on a zero/absent denominator', () => {
        expect(__test.perUnitPence(1000, 4)).toBe(250);
        expect(__test.perUnitPence(1000, 0)).toBeNull();
        expect(__test.perUnitPence(1000, null)).toBeNull();
    });

    it('ratio divides, and returns null on a zero/absent denominator', () => {
        expect(__test.ratio(50, 200)).toBe(0.25);
        expect(__test.ratio(50, 0)).toBeNull();
    });

    it('numOrNull passes numbers and numeric strings through, keeps null/undefined as null', () => {
        expect(__test.numOrNull(7)).toBe(7);
        expect(__test.numOrNull('7.5')).toBe(7.5);
        expect(__test.numOrNull(null)).toBeNull();
        expect(__test.numOrNull(undefined)).toBeNull();
    });

    it('excludedAccountsOf partitions by the shared GBP currency guard', () => {
        const out = __test.excludedAccountsOf([
            { customer_id: 'a', name: 'A', currency: 'GBP' },
            { customer_id: 'b', name: 'B', currency: 'EUR' },
        ]);
        expect(out).toEqual([{ customerId: 'b', name: 'B', currency: 'EUR', reason: 'unsupported_currency' }]);
    });
});
