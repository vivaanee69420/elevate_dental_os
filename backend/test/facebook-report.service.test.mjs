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
        hasProviderMetrics: vi.fn(),
        hasGrainMetrics: vi.fn(),
    },
}));
vi.mock('../src/repositories/ad-grain.repository.js', () => ({
    GRAINS: ['meta_adset', 'meta_ad', 'google_adgroup', 'google_ad', 'google_keyword'],
    adGrainRepository: { rollup: vi.fn() },
}));

const { facebookReportService, invalidateFunnelCache, __test } = await import('../src/services/facebook-report.service.js');
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
    // The funnel is cached in-process for 60s (loadFunnel) so that expanding
    // several ad sets does not re-run the whole org's funnel once per
    // expansion. Every test below reuses ORG and WIN with different mocked
    // rows, so the cache must be cleared between them or a test would assert
    // against the previous one's data.
    invalidateFunnelCache();
    // Default: this org HAS synced Meta before, at both campaign grain AND
    // this deep tier, so an empty window is a quiet window, not a missing
    // sync or unsynced detail. Tests that mean "never synced" or
    // "detail_not_synced" say so.
    marketingRepository.hasProviderMetrics.mockResolvedValue(true);
    marketingRepository.hasGrainMetrics.mockResolvedValue(true);
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

        const adSetOut = await facebookReportService.adSets(ORG, { since: tooEarly, until, practiceId: null, campaignId: 'CMP1' });
        expect(adSetOut.effectiveSince).toBe(floor);
        expect(adSetOut.windowClamped).toBe(true);

        const adsOut = await facebookReportService.ads(ORG, { since: tooEarly, until, practiceId: null, adSetId: 'AS1' });
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

    it('carries effectiveSince and windowClamped on the empty-window early return', async () => {
        marketingRepository.campaignSpendByProvider.mockResolvedValue([]);
        marketingRepository.hasProviderMetrics.mockResolvedValue(false);
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

    // I3: "no spend rows in THIS WINDOW" is not evidence a sync never
    // happened. These two tests differ ONLY in the out-of-window probe, and
    // that is the point: asserting the state string alone cannot tell a
    // never-synced tenant from a quiet window, which is exactly how the old
    // single test let the wrong copy ship.
    it('reports never_synced only when NO Meta metric row has ever landed for the org', async () => {
        marketingRepository.campaignSpendByProvider.mockResolvedValue([]);
        adGrainRepository.rollup.mockResolvedValue([]);
        marketingRepository.hasProviderMetrics.mockResolvedValue(false);
        const out = await facebookReportService.campaigns(ORG, WIN);
        expect(out.state).toBe('never_synced');
        // The probe must be OUTSIDE the window — no since/until — or it is
        // just the empty window asked a second time.
        expect(marketingRepository.hasProviderMetrics).toHaveBeenCalledWith(ORG, 'meta_ads');
    });

    it('reports no_spend_in_window, NOT never_synced, for a synced tenant whose window is simply empty', async () => {
        marketingRepository.campaignSpendByProvider.mockResolvedValue([]);
        adGrainRepository.rollup.mockResolvedValue([]);
        marketingRepository.hasProviderMetrics.mockResolvedValue(true);
        const out = await facebookReportService.campaigns(ORG, WIN);
        expect(out.state).toBe('no_spend_in_window');
    });

    it('applies the same distinction at the ad-set tier, where a practice filter can empty the rollup, when the deep table has synced before', async () => {
        adGrainRepository.rollup.mockResolvedValue([]);
        // This tier's OWN deep table (ad_meta_adsets) has landed a row
        // before — just none in this window/filter.
        marketingRepository.hasProviderMetrics.mockResolvedValue(true);
        marketingRepository.hasGrainMetrics.mockResolvedValue(true);
        const quiet = await facebookReportService.adSets(ORG, { ...WIN, campaignId: 'CMP1' });
        expect(quiet.state).toBe('no_spend_in_window');

        invalidateFunnelCache();
        marketingRepository.hasProviderMetrics.mockResolvedValue(false);
        const fresh = await facebookReportService.adSets(ORG, { ...WIN, campaignId: 'CMP1' });
        expect(fresh.state).toBe('never_synced');
    });

    // ===========================================================================
    // MAJOR 2: detail_not_synced — campaign-grain ad_metrics IS populated for
    // this org (campaigns() is 'ok'), but the ad-set deep table
    // (ad_meta_adsets) has NEVER received a row. Before this fix,
    // emptyWindowState only ever probed ad_metrics, so this exact case
    // returned 'no_spend_in_window' — "this is not a sync problem" — ruling
    // out the one true explanation. These tests FAIL without the fix.
    // ===========================================================================
    it('reports detail_not_synced at the ad-set tier, NOT no_spend_in_window, when ad_metrics has rows but ad_meta_adsets never has', async () => {
        adGrainRepository.rollup.mockResolvedValue([]);
        marketingRepository.hasProviderMetrics.mockResolvedValue(true);
        marketingRepository.hasGrainMetrics.mockResolvedValue(false);
        const out = await facebookReportService.adSets(ORG, { ...WIN, campaignId: 'CMP1' });
        expect(out.state).toBe('detail_not_synced');
        expect(marketingRepository.hasGrainMetrics).toHaveBeenCalledWith(ORG, 'ad_meta_adsets');
    });

    it('campaigns() has no third state — an empty window is never_synced/no_spend_in_window only, and never consults hasGrainMetrics', async () => {
        marketingRepository.campaignSpendByProvider.mockResolvedValue([]);
        marketingRepository.hasProviderMetrics.mockResolvedValue(true);
        const out = await facebookReportService.campaigns(ORG, WIN);
        expect(out.state).toBe('no_spend_in_window');
        expect(marketingRepository.hasGrainMetrics).not.toHaveBeenCalled();
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

// ===========================================================================
// C1 — the date-semantics boundary between the funnel and the spend readers.
//
// ad_meta_funnel bounds leads `created_at >= $2 AND created_at < $3` (a
// half-open timestamptz range: a lead carries a time). campaignSpendByProvider
// and ad_grain_rollup bound `metric_date <= until` (inclusive: metric_date is a
// date, and the reconciliation endpoint depends on that convention). Feeding
// one inclusive YYYY-MM-DD to both silently drops the last day's leads —
// measured on live data, an August view returned 1,295 leads against a true
// 1,336, and a single-day selection returned ZERO leads beside that day's real
// spend, showing every cost as an em dash with no caveat.
//
// These tests assert on the RECORDED MOCK CALLS rather than on the payload,
// because the payload can look right while the call underneath used the wrong
// bound — and because a future edit that converts the WRONG one of the three
// readers is exactly what this must catch.
// ===========================================================================
describe('funnel/spend date semantics', () => {
    it('sends the funnel an EXCLUSIVE until one day past the inclusive one, while both spend readers get the inclusive day', async () => {
        const win = { since: londonDaysAgo(DEEP_WINDOW_DAYS - 40), until: '2026-08-31', practiceId: null };

        await facebookReportService.campaigns(ORG, win);
        invalidateFunnelCache();
        await facebookReportService.adSets(ORG, { ...win, campaignId: 'CMP1' });

        // The funnel: one day LATER, so 31 August's leads are inside the range.
        expect(marketingRepository.metaFunnel.mock.calls.length).toBeGreaterThan(0);
        for (const c of marketingRepository.metaFunnel.mock.calls) {
            expect(c[1]).toBe(win.since);
            expect(c[2]).toBe('2026-09-01');
        }
        // The DATE-column readers: the inclusive day itself, unchanged. If a
        // later edit converts these instead of the funnel, this fails.
        expect(marketingRepository.campaignSpendByProvider.mock.calls.length).toBeGreaterThan(0);
        for (const c of marketingRepository.campaignSpendByProvider.mock.calls) {
            expect(c[1]).toBe(win.since);
            expect(c[2]).toBe('2026-08-31');
        }
        expect(adGrainRepository.rollup.mock.calls.length).toBeGreaterThan(0);
        for (const c of adGrainRepository.rollup.mock.calls) {
            expect(c[2].since).toBe(win.since);
            expect(c[2].until).toBe('2026-08-31');
        }
    });

    // The failure the owner would actually see: a day with real spend and real
    // leads reported as a day that produced nobody.
    it('returns a NON-ZERO lead count for a single-day selection (since === until)', async () => {
        const day = londonDaysAgo(3);
        const out = await facebookReportService.campaigns(ORG, { since: day, until: day, practiceId: null });
        expect(out.rows[0].leads).toBe(10);
        expect(out.rows[0].cplPence).not.toBeNull();
        const [, since, until] = marketingRepository.metaFunnel.mock.calls[0];
        expect(since).toBe(day);
        expect(until).not.toBe(day);
        expect(new Date(`${until}T00:00:00Z`) - new Date(`${day}T00:00:00Z`)).toBe(86_400_000);
    });

    it('does calendar arithmetic, so it rolls over a month/year end and survives a DST day', async () => {
        const { funnelUntil } = __test;
        expect(funnelUntil('2026-08-31')).toBe('2026-09-01');
        expect(funnelUntil('2026-12-31')).toBe('2027-01-01');
        expect(funnelUntil('2028-02-28')).toBe('2028-02-29');   // leap year
        // UK spring forward: 29 March 2026 is only 23 real hours long, so a
        // fixed +86_400_000ms on a London instant would land on the wrong day.
        expect(funnelUntil('2026-03-29')).toBe('2026-03-30');
    });
});

// ===========================================================================
// C2 — the campaign tier's spend must honour the practice filter its funnel
// already honours. It did not: campaignSpendByProvider took no practice
// parameter at all, so a five-practice group filtering to ONE practice
// divided the WHOLE GROUP's Meta spend by that practice's leads (costs ~5x
// the truth), stated a group-wide Total under a practice-specific heading,
// and contradicted the ad-set tier below it, which always did filter.
//
// Every other test in this file passes practiceId: null. That is precisely why
// this survived review, so these tests pass a real one.
// ===========================================================================
describe('practice scope reaches every reader', () => {
    const PRACTICE = '22222222-2222-2222-2222-222222222222';

    it('forwards practiceId to the campaign tier’s spend read as well as its funnel', async () => {
        await facebookReportService.campaigns(ORG, { ...WIN, practiceId: PRACTICE });
        for (const c of marketingRepository.campaignSpendByProvider.mock.calls) {
            expect(c[5]).toBe(PRACTICE);   // 6th arg, after customerIds
        }
        for (const c of marketingRepository.metaFunnel.mock.calls) expect(c[3]).toBe(PRACTICE);
    });

    it('forwards practiceId to all three readers across all three tiers', async () => {
        await facebookReportService.campaigns(ORG, { ...WIN, practiceId: PRACTICE });
        invalidateFunnelCache();
        await facebookReportService.adSets(ORG, { ...WIN, practiceId: PRACTICE, campaignId: 'CMP1' });
        invalidateFunnelCache();
        await facebookReportService.ads(ORG, { ...WIN, practiceId: PRACTICE, adSetId: 'AS1' });

        for (const c of marketingRepository.campaignSpendByProvider.mock.calls) expect(c[5]).toBe(PRACTICE);
        for (const c of marketingRepository.metaFunnel.mock.calls) expect(c[3]).toBe(PRACTICE);
        expect(adGrainRepository.rollup.mock.calls.length).toBeGreaterThan(0);
        for (const c of adGrainRepository.rollup.mock.calls) expect(c[2].practiceId).toBe(PRACTICE);
    });

    // The reconciliation service calls this repository method with five
    // positional arguments and must be unaffected: practiceId is LAST and
    // defaults to null.
    it('sends null, not undefined, when no practice is selected', async () => {
        await facebookReportService.campaigns(ORG, WIN);
        for (const c of marketingRepository.campaignSpendByProvider.mock.calls) expect(c[5]).toBeNull();
    });
});

// ===========================================================================
// Task 2 — the case that did not exist before this change: adSets/ads run
// with NO parent id at all. Both methods only ever ran inside a drill-down
// (campaignId/adSetId was a required positional argument), so a standalone
// tab that must list EVERY ad set, or EVERY ad, across the whole window had
// no way to call them. campaignId/adSetId are now optional keys on the
// options object — filterParams in ad-grain.repository.js already defaults
// both to null, so the unfiltered case needed no repository change, only the
// service no longer forcing a value through.
// ===========================================================================
describe('parent id is an optional filter, not a required drill-down', () => {
    it('adSets with no campaignId returns every ad set in the window, across campaigns', async () => {
        adGrainRepository.rollup.mockResolvedValue([
            { entity_id: 'AS1', entity_name: 'Photos 35+', parent_id: 'CMP1',
              campaign_id: 'CMP1', entity_status: null,
              spend_pence: 60000, impressions: 3000, clicks: 150, conversions: 0 },
            { entity_id: 'AS2', entity_name: 'Video 25-34', parent_id: 'CMP2',
              campaign_id: 'CMP2', entity_status: null,
              spend_pence: 40000, impressions: 2000, clicks: 100, conversions: 0 },
        ]);
        marketingRepository.metaFunnel.mockResolvedValue([
            { campaign_id: 'CMP1', ad_set_id: 'AS1', ad_id: 'AD1', practice_id: null,
              leads: 6, booked: 3, attended: 1, patients: 1, new_patients: 1 },
            { campaign_id: 'CMP2', ad_set_id: 'AS2', ad_id: 'AD2', practice_id: null,
              leads: 4, booked: 1, attended: 0, patients: 0, new_patients: 0 },
        ]);
        // No campaignId key at all — WIN alone, exactly what a standalone
        // "Ad sets" tab would call.
        const out = await facebookReportService.adSets(ORG, WIN);
        expect(out.rows.map((r) => r.id).sort()).toEqual(['AS1', 'AS2']);
        // The repository itself must have been asked with no campaign filter —
        // not, say, silently defaulted to the first campaign it saw.
        expect(adGrainRepository.rollup).toHaveBeenCalledWith(
            ORG, 'meta_adset', expect.objectContaining({ campaignId: null }),
        );
        // Coverage is computed over BOTH campaigns' leads, not just one — the
        // whole point of the funnel no longer being filtered to one campaign.
        expect(out.coverage.leadsTotal).toBe(10);
    });

    it('adSets with a campaignId still returns only that campaign’s ad sets — existing behaviour, unchanged', async () => {
        adGrainRepository.rollup.mockResolvedValue([
            { entity_id: 'AS1', entity_name: 'Photos 35+', parent_id: 'CMP1',
              campaign_id: 'CMP1', entity_status: null,
              spend_pence: 60000, impressions: 3000, clicks: 150, conversions: 0 },
        ]);
        const out = await facebookReportService.adSets(ORG, { ...WIN, campaignId: 'CMP1' });
        expect(adGrainRepository.rollup).toHaveBeenCalledWith(
            ORG, 'meta_adset', expect.objectContaining({ campaignId: 'CMP1' }),
        );
        expect(out.rows.map((r) => r.id)).toEqual(['AS1']);
    });

    it('ads with no adSetId returns every ad in the window, across ad sets', async () => {
        adGrainRepository.rollup.mockResolvedValue([
            { entity_id: 'AD1', entity_name: 'Ad one', parent_id: 'AS1',
              campaign_id: 'CMP1', entity_status: 'ACTIVE',
              spend_pence: 3000, impressions: 100, clicks: 5, conversions: 0 },
            { entity_id: 'AD2', entity_name: 'Ad two', parent_id: 'AS2',
              campaign_id: 'CMP1', entity_status: 'ACTIVE',
              spend_pence: 2000, impressions: 80, clicks: 3, conversions: 0 },
        ]);
        // No adSetId key at all — WIN alone.
        const out = await facebookReportService.ads(ORG, WIN);
        expect(out.rows.map((r) => r.id).sort()).toEqual(['AD1', 'AD2']);
        expect(adGrainRepository.rollup).toHaveBeenCalledWith(
            ORG, 'meta_ad', expect.objectContaining({ parentId: null }),
        );
    });

    it('ads with an adSetId still returns only that ad set’s ads — existing behaviour, unchanged', async () => {
        adGrainRepository.rollup.mockResolvedValue([
            { entity_id: 'AD1', entity_name: 'Ad one', parent_id: 'AS1',
              campaign_id: 'CMP1', entity_status: 'ACTIVE',
              spend_pence: 3000, impressions: 100, clicks: 5, conversions: 0 },
        ]);
        const out = await facebookReportService.ads(ORG, { ...WIN, adSetId: 'AS1' });
        expect(adGrainRepository.rollup).toHaveBeenCalledWith(
            ORG, 'meta_ad', expect.objectContaining({ parentId: 'AS1' }),
        );
        expect(out.rows.map((r) => r.id)).toEqual(['AD1']);
    });

    // Costs stay null, not 0, on the unfiltered path too — perUnitPence is
    // untouched by this change, but the unfiltered list is a new call shape
    // and deserves its own assertion rather than trusting it by inference.
    it('returns null costs, not 0, for a listed ad set with spend but no leads', async () => {
        adGrainRepository.rollup.mockResolvedValue([
            { entity_id: 'AS1', entity_name: 'Photos 35+', parent_id: 'CMP1',
              campaign_id: 'CMP1', entity_status: null,
              spend_pence: 60000, impressions: 3000, clicks: 150, conversions: 0 },
        ]);
        marketingRepository.metaFunnel.mockResolvedValue([]);
        const out = await facebookReportService.adSets(ORG, WIN);
        const row = out.rows.find((r) => r.id === 'AS1');
        expect(row.cplPence).toBeNull();
        expect(row.cpbPence).toBeNull();
        expect(row.cpaPence).toBeNull();
    });

    // The service call itself is mocked here (the repository's own p_org
    // scoping and cross-org proof live in marketing.isolation.test.mjs); this
    // pins that the SERVICE forwards exactly the org it was given on the
    // unfiltered call, and renders only what that call returns — an
    // unfiltered listing is the one shape that did not exist before this
    // task, so it gets its own isolation check rather than inheriting the
    // filtered-path one by assumption.
    it('never returns another org’s ad sets when listing unfiltered', async () => {
        const OTHER_ORG = '99999999-9999-9999-9999-999999999999';
        adGrainRepository.rollup.mockImplementation(async (orgId) => (
            orgId === ORG
                ? [{ entity_id: 'AS1', entity_name: 'Mine', parent_id: 'CMP1',
                     campaign_id: 'CMP1', entity_status: null,
                     spend_pence: 1000, impressions: 10, clicks: 1, conversions: 0 }]
                : [{ entity_id: 'AS_OTHER', entity_name: 'Not mine', parent_id: 'CMP9',
                     campaign_id: 'CMP9', entity_status: null,
                     spend_pence: 1000, impressions: 10, clicks: 1, conversions: 0 }]
        ));
        const mine = await facebookReportService.adSets(ORG, WIN);
        expect(mine.rows.map((r) => r.id)).toEqual(['AS1']);
        expect(mine.rows.map((r) => r.id)).not.toContain('AS_OTHER');

        invalidateFunnelCache();
        const theirs = await facebookReportService.adSets(OTHER_ORG, WIN);
        expect(theirs.rows.map((r) => r.id)).toEqual(['AS_OTHER']);
        expect(theirs.rows.map((r) => r.id)).not.toContain('AS1');
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
        const out = await facebookReportService.adSets(ORG, { ...WIN, campaignId: 'CMP1' });
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
        const out = await facebookReportService.adSets(ORG, { ...WIN, campaignId: 'CMP1' });
        expect(out.rows.map((r) => r.id)).toEqual(['AS1']);
        // Leads we could not place: counted, but never given spend or a cost.
        expect(out.notIdentified).toEqual({ leads: 4, booked: 1, attended: 0, patients: 0, newPatients: 0 });
    });

    it('omits the unidentified bucket entirely when coverage is complete', async () => {
        const out = await facebookReportService.adSets(ORG, { ...WIN, campaignId: 'CMP1' });
        expect(out.notIdentified).toBeNull();
    });

    // I5: an ad set that RESOLVED but is absent from this window's rollup —
    // no delivery in the window, or its spend sits under a different practice
    // mapping — used to fall through every bucket. notIdentified only catches
    // ad_set_id === null, so those leads appeared in no row and in no bucket:
    // the campaign row said 100 and this table summed to 80, with 20 gone.
    it('puts a resolved-but-unshown ad set in unmatchedLeads instead of dropping it', async () => {
        adGrainRepository.rollup.mockResolvedValue([
            { entity_id: 'AS1', entity_name: 'Photos 35+', parent_id: 'CMP1',
              campaign_id: 'CMP1', entity_status: null,
              spend_pence: 60000, impressions: 3000, clicks: 150, conversions: 0 },
        ]);
        marketingRepository.metaFunnel.mockResolvedValue([
            { campaign_id: 'CMP1', ad_set_id: 'AS1', ad_id: 'AD1', practice_id: null,
              leads: 6, booked: 3, attended: 1, patients: 1, new_patients: 1 },
            // AS_GONE resolved, but has no spend row in this window.
            { campaign_id: 'CMP1', ad_set_id: 'AS_GONE', ad_id: 'AD9', practice_id: null,
              leads: 5, booked: 2, attended: 1, patients: 1, new_patients: 0 },
            { campaign_id: 'CMP1', ad_set_id: null, ad_id: null, practice_id: null,
              leads: 4, booked: 1, attended: 0, patients: 0, new_patients: 0 },
        ]);
        const out = await facebookReportService.adSets(ORG, { ...WIN, campaignId: 'CMP1' });
        expect(out.rows.map((r) => r.id)).toEqual(['AS1']);
        expect(out.unmatchedLeads).toEqual({ leads: 5, booked: 2, attended: 1, patients: 1, newPatients: 0 });
        expect(out.notIdentified).toEqual({ leads: 4, booked: 1, attended: 0, patients: 0, newPatients: 0 });
    });

    it('omits unmatchedLeads when every resolved ad set is on screen', async () => {
        adGrainRepository.rollup.mockResolvedValue([
            { entity_id: 'AS1', entity_name: 'Photos 35+', parent_id: 'CMP1',
              campaign_id: 'CMP1', entity_status: null,
              spend_pence: 60000, impressions: 3000, clicks: 150, conversions: 0 },
        ]);
        const out = await facebookReportService.adSets(ORG, { ...WIN, campaignId: 'CMP1' });
        expect(out.unmatchedLeads).toBeNull();
    });

    // THE reconciliation assertion the owner cares about: drilling into a
    // campaign must not lose or invent a single lead. rows + notIdentified +
    // unmatchedLeads has to equal the campaign tier's own row, computed from
    // the SAME funnel by a different code path.
    it('reconciles exactly to the campaign tier’s row for the same campaign', async () => {
        const funnel = [
            { campaign_id: 'CMP1', ad_set_id: 'AS1', ad_id: 'AD1', practice_id: null,
              leads: 60, booked: 20, attended: 9, patients: 7, new_patients: 4 },
            { campaign_id: 'CMP1', ad_set_id: 'AS_GONE', ad_id: 'AD9', practice_id: null,
              leads: 20, booked: 5, attended: 2, patients: 1, new_patients: 1 },
            { campaign_id: 'CMP1', ad_set_id: null, ad_id: null, practice_id: null,
              leads: 20, booked: 4, attended: 1, patients: 1, new_patients: 0 },
        ];
        marketingRepository.metaFunnel.mockResolvedValue(funnel);
        adGrainRepository.rollup.mockResolvedValue([
            { entity_id: 'AS1', entity_name: 'Photos 35+', parent_id: 'CMP1',
              campaign_id: 'CMP1', entity_status: null,
              spend_pence: 60000, impressions: 3000, clicks: 150, conversions: 0 },
        ]);

        const campaigns = await facebookReportService.campaigns(ORG, WIN);
        const campaignRow = campaigns.rows.find((r) => r.id === 'CMP1');
        const adSets = await facebookReportService.adSets(ORG, { ...WIN, campaignId: 'CMP1' });

        const shown = adSets.rows.reduce((n, r) => n + r.leads, 0);
        const buckets = (adSets.notIdentified?.leads ?? 0) + (adSets.unmatchedLeads?.leads ?? 0);
        expect(shown + buckets).toBe(campaignRow.leads);
        expect(campaignRow.leads).toBe(100);
        // Same for the rest of the funnel, not just leads.
        const sumOf = (k) => adSets.rows.reduce((n, r) => n + r[k], 0)
            + (adSets.notIdentified?.[k] ?? 0) + (adSets.unmatchedLeads?.[k] ?? 0);
        expect(sumOf('booked')).toBe(campaignRow.booked);
        expect(sumOf('patients')).toBe(campaignRow.patients);
    });

    // I6: ad_grain_rollup's RETURNS TABLE has no `reach`, so the column was an
    // em dash on every row for every tenant, under a header tooltip and a
    // footnote explaining a number that never appeared. Removed rather than
    // shipped empty; this pins it so it cannot creep back as a null field.
    it('carries no reach field — the rollup does not return one', async () => {
        adGrainRepository.rollup.mockResolvedValue([
            { entity_id: 'AS1', entity_name: 'Photos 35+', parent_id: 'CMP1',
              campaign_id: 'CMP1', entity_status: null,
              spend_pence: 60000, impressions: 3000, clicks: 150, conversions: 0 },
        ]);
        const out = await facebookReportService.adSets(ORG, { ...WIN, campaignId: 'CMP1' });
        expect(out.rows[0]).not.toHaveProperty('reach');
    });
});

// M1: campaign_status is the whole reason campaignSpendByProvider's select was
// widened. collapseByCampaign dropped it, so `status` was null on every row.
describe('campaign status', () => {
    it('takes the status from the LATEST day, not from whatever row came back last', async () => {
        // Deliberately out of date order, because ad_metrics.id is a random
        // uuid: "the last row read" is arbitrary and would flip between reads.
        marketingRepository.campaignSpendByProvider.mockResolvedValue([
            { campaign_id: 'CMP1', campaign_name: 'Implants', campaign_status: 'PAUSED',
              metric_date: '2026-08-20', spend_pence: 40000, impressions: 2000, clicks: 100 },
            { campaign_id: 'CMP1', campaign_name: 'Implants', campaign_status: 'ACTIVE',
              metric_date: '2026-08-01', spend_pence: 60000, impressions: 3000, clicks: 150 },
        ]);
        const out = await facebookReportService.campaigns(ORG, WIN);
        // Paused on the 20th: the report says paused, which is what a status
        // column means. Spend still sums across both days.
        expect(out.rows[0].status).toBe('PAUSED');
        expect(out.rows[0].spendPence).toBe(100000);
    });

    it('does not leak the internal status-date accumulator into a row', async () => {
        marketingRepository.campaignSpendByProvider.mockResolvedValue([
            { campaign_id: 'CMP1', campaign_name: 'Implants', campaign_status: 'ACTIVE',
              metric_date: '2026-08-01', spend_pence: 60000, impressions: 3000, clicks: 150 },
        ]);
        const out = await facebookReportService.campaigns(ORG, WIN);
        expect(out.rows[0]).not.toHaveProperty('_statusDate');
        expect(out.rows[0].status).toBe('ACTIVE');
    });

    it('leaves status null when the feed carries none, rather than inventing one', async () => {
        const out = await facebookReportService.campaigns(ORG, WIN);
        expect(out.rows[0].status).toBeNull();
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
        const out = await facebookReportService.ads(ORG, { ...WIN, adSetId: 'AS1' });
        expect(out.rows).toHaveLength(50);
        expect(out.nextCursor).toBe('50');
    });

    it('pages through with no overlap and no gap, ending on nextCursor: null', async () => {
        const rows = Array.from({ length: 120 }, (_, i) => grainRow(`AD${String(i).padStart(3, '0')}`, 1000 - i));
        adGrainRepository.rollup.mockResolvedValue(rows);

        const page1 = await facebookReportService.ads(ORG, { ...WIN, adSetId: 'AS1' });
        const page2 = await facebookReportService.ads(ORG, { ...WIN, cursor: page1.nextCursor, adSetId: 'AS1' });
        const page3 = await facebookReportService.ads(ORG, { ...WIN, cursor: page2.nextCursor, adSetId: 'AS1' });

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

        const out1 = await facebookReportService.ads(ORG, { ...WIN, adSetId: 'AS1' });
        const out2 = await facebookReportService.ads(ORG, { ...WIN, adSetId: 'AS1' });

        expect(out1.rows.map((r) => r.id)).toEqual(['AD_A', 'AD_B', 'AD_M', 'AD_Y', 'AD_Z']);
        expect(out2.rows.map((r) => r.id)).toEqual(out1.rows.map((r) => r.id));
    });
});

// ads() used to have no state of its own at all — the frontend borrowed
// campaigns()'s state to explain an empty Ads tab (not_connected/never_synced
// only; see FacebookAdsTab's old header comment). That borrowing reads a
// DIFFERENT query answering a DIFFERENT question: campaigns() is computed
// from ad_metrics' campaign-day rows and org/campaign-wide ad-set coverage,
// while ads() is computed from the deep-grain ad rollup (a separate table,
// separate sync) and ad-level (ad_id) coverage. These tests pin cases where
// the two genuinely disagree — exactly the cases the borrowing got wrong.
describe("ads() computes its own state, from its own grain — not campaigns()'s", () => {
    it('reports not_connected when the org has no Meta ad account (ads() had no accounts check at all before this fix)', async () => {
        marketingRepository.adAccountsForProvider.mockResolvedValue([]);
        const out = await facebookReportService.ads(ORG, { ...WIN, adSetId: 'AS1' });
        expect(out.state).toBe('not_connected');
        expect(out.rows).toEqual([]);
        expect(out.nextCursor).toBeNull();
    });

    // THE case the borrowing gets wrong: campaigns() reads ad_metrics'
    // campaign-day rows and is healthy (spend exists, ad-set coverage is
    // fine) — but the deep-grain ad rollup, a separate table populated by a
    // separate sync, has nothing for this window. campaigns()'s state gives
    // no hint anything is wrong at the ad grain; borrowing it would render
    // an unexplained empty Ads tab for a tenant whose ad-level sync simply
    // has not caught up.
    it('reports no_spend_in_window at the ad grain even though campaigns() is ok for the same org and window, when ad_meta_ads has synced before', async () => {
        const campaignsOut = await facebookReportService.campaigns(ORG, WIN);
        expect(campaignsOut.state).toBe('ok');

        // ad_meta_ads landed a row before (beforeEach default) — just none
        // in this window.
        adGrainRepository.rollup.mockResolvedValue([]);
        const adsOut = await facebookReportService.ads(ORG, WIN);
        expect(adsOut.state).toBe('no_spend_in_window');
    });

    // Same shape, the never_synced twin: the deep-grain ad table has never
    // received a row for this org, which campaigns() (reading a different
    // table) cannot see either way.
    it('reports never_synced at the ad grain when no Meta metric row has ever landed for the org, independent of campaigns()', async () => {
        const campaignsOut = await facebookReportService.campaigns(ORG, WIN);
        expect(campaignsOut.state).toBe('ok');

        adGrainRepository.rollup.mockResolvedValue([]);
        marketingRepository.hasProviderMetrics.mockResolvedValue(false);
        const adsOut = await facebookReportService.ads(ORG, WIN);
        expect(adsOut.state).toBe('never_synced');
    });

    // MAJOR 2: campaigns() is 'ok' (real spend, real totals) but the ad-level
    // deep table (ad_meta_ads) has NEVER received a row for this org — not
    // merely quiet in this window. Before this fix, ads() could not tell that
    // apart from no_spend_in_window at all: emptyWindowState only ever probed
    // ad_metrics. This test FAILS without the fix (it would see
    // 'no_spend_in_window' instead).
    it('reports detail_not_synced at the ad grain when campaigns() is ok but ad_meta_ads has never synced', async () => {
        const campaignsOut = await facebookReportService.campaigns(ORG, WIN);
        expect(campaignsOut.state).toBe('ok');

        adGrainRepository.rollup.mockResolvedValue([]);
        marketingRepository.hasGrainMetrics.mockResolvedValue(false);
        const adsOut = await facebookReportService.ads(ORG, WIN);
        expect(adsOut.state).toBe('detail_not_synced');
        expect(marketingRepository.hasGrainMetrics).toHaveBeenCalledWith(ORG, 'ad_meta_ads');
    });

    it('reports ok, not no_ad_id_coverage, when there are simply no leads in scope for this ad set', async () => {
        adGrainRepository.rollup.mockResolvedValue([
            { entity_id: 'AD1', entity_name: 'Ad one', parent_id: 'AS1',
              campaign_id: 'CMP1', entity_status: 'ACTIVE',
              spend_pence: 3000, impressions: 100, clicks: 5, conversions: 0 },
        ]);
        marketingRepository.metaFunnel.mockResolvedValue([]);
        const out = await facebookReportService.ads(ORG, { ...WIN, adSetId: 'AS1' });
        expect(out.state).toBe('ok');
    });

    // Ad-level coverage (ad_id), not ad-set-level (ad_set_id) — this grain's
    // own question, computed over its own funnel rows.
    it('reports no_ad_id_coverage when leads in scope carry no ad_id at all', async () => {
        adGrainRepository.rollup.mockResolvedValue([
            { entity_id: 'AD1', entity_name: 'Ad one', parent_id: 'AS1',
              campaign_id: 'CMP1', entity_status: 'ACTIVE',
              spend_pence: 3000, impressions: 100, clicks: 5, conversions: 0 },
        ]);
        marketingRepository.metaFunnel.mockResolvedValue([
            { campaign_id: 'CMP1', ad_set_id: null, ad_id: null, practice_id: null,
              leads: 12, booked: 0, attended: 0, patients: 0, new_patients: 0 },
        ]);
        const out = await facebookReportService.ads(ORG, WIN);
        expect(out.state).toBe('no_ad_id_coverage');
    });
});

// I7: ads() calls the funnel unfiltered by campaign or ad set, and the
// repository PAGES it — re-executing ad_lead_conversions, documented at 2.8s
// for 10,429 rows. Expanding five ad sets on one screen meant five full-org
// funnel computations. This codebase has already taken a statement timeout
// from fan-out rather than volume (Business Hub, 16 aggregates in one
// Promise.all), so the fix is the same 60s in-process cache that solved it
// there. Filtering the funnel by ad set would NOT have helped: the cost is in
// resolving every lead in the window, which happens before the grouping.
describe('funnel is computed once per org+window, not once per expansion', () => {
    it('serves five ad-set expansions from one funnel computation', async () => {
        for (const adSetId of ['AS1', 'AS2', 'AS3', 'AS4', 'AS5']) {
            await facebookReportService.ads(ORG, { ...WIN, adSetId });
        }
        expect(marketingRepository.metaFunnel).toHaveBeenCalledTimes(1);
        // The rollup is per ad set and correctly still runs each time.
        expect(adGrainRepository.rollup).toHaveBeenCalledTimes(5);
    });

    // A cache that ignored a dimension would serve one tenant another's leads,
    // or one practice another's — the key must carry all four.
    it('never serves one org, window or practice from another’s entry', async () => {
        const OTHER_ORG = '99999999-9999-9999-9999-999999999999';
        const PRACTICE = '22222222-2222-2222-2222-222222222222';
        await facebookReportService.ads(ORG, { ...WIN, adSetId: 'AS1' });
        await facebookReportService.ads(OTHER_ORG, { ...WIN, adSetId: 'AS1' });
        await facebookReportService.ads(ORG, { ...WIN, practiceId: PRACTICE, adSetId: 'AS1' });
        await facebookReportService.ads(ORG, { ...WIN, until: '2026-08-30', adSetId: 'AS1' });
        expect(marketingRepository.metaFunnel).toHaveBeenCalledTimes(4);
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

    // M1, service-level analogue: the controller strips a submitted
    // organisation_id off the query before this is ever called (pinned in
    // marketing.isolation.test.mjs's "has no organisation field" test), but
    // that guard is only as good as this function actually honouring it — a
    // service that read an org id out of ITS options bag would reopen the
    // hole from underneath a perfectly good controller. orgId is only ever
    // the first positional argument; an organisation-shaped field smuggled
    // into the options object (the closest a caller can get to a spoofed
    // query.organisation_id / body.organisation_id at this layer) must be
    // inert.
    it('ignores any organisation-shaped field inside the options object — the org id is only ever the first positional argument', async () => {
        const spoofed = { ...WIN, organisation_id: 'evil-org', organisationId: 'evil-org' };
        await facebookReportService.campaigns(ORG, spoofed);
        invalidateFunnelCache();
        await facebookReportService.adSets(ORG, spoofed);
        invalidateFunnelCache();
        await facebookReportService.ads(ORG, spoofed);

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
