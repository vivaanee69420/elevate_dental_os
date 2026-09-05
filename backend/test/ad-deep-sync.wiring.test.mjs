// Wiring the deep-grain pulls (Google: ad group/ad/keyword; Meta: ad set/ad)
// into the two EXISTING nightly campaign syncs. The deep pull must run AFTER
// the campaign-grain ad_metrics_replace_window call and must be wrapped so it
// can NEVER fail the campaign sync: campaign grain feeds every existing
// marketing figure in the product, while deep grain feeds two new pages that
// tolerate being a day stale. A keyword/ad-set pull that trips a platform
// throttle must not cost the day's spend, and markSynced must still be
// reached.
//
// Currency filtering happens HERE, in the wiring, before syncGoogleDeep /
// syncMetaDeep are ever called — the deep connectors deliberately do not call
// partitionAccountsByCurrency themselves.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { supaRec } from './setup.js';
import { encryptSecret } from '../src/lib/crypto.js';
import { londonDaysAgo, londonYmd } from '../src/lib/tz.js';

vi.mock('../src/repositories/integration.repository.js', () => ({
    integrationRepository: {
        upsert: vi.fn(), markFailed: vi.fn(), markSynced: vi.fn(), getByProvider: vi.fn(),
        upsertAdAccounts: vi.fn(), markAdAccountStatus: vi.fn(), listAdAccounts: vi.fn(async () => []),
    },
}));
// Both google-ads-sync.js AND meta-ads-sync.js import DEEP_WINDOW_DAYS from
// this module (RULING D: one constant, not a per-provider literal) — mocking
// it here supplies the same value to both.
vi.mock('../src/lib/integrations/google-ads-deep-sync.js', () => ({
    DEEP_WINDOW_DAYS: 92,
    // Statically imported by google-ads-sync.js's buildGaql, so the mock must
    // supply it — same reason meta's LEVEL_FIELDS is here. The campaign share
    // list lives in the deep-sync module because that is where the measured
    // per-resource support table lives; a second copy in the campaign sync is
    // what left three ad-group pulls degraded.
    CAMPAIGN_SHARE_METRICS: 'metrics.search_impression_share',
    syncGoogleDeep: vi.fn(async () => ({ counts: { google_adgroup: 3 }, skipped: [] })),
}));
vi.mock('../src/lib/integrations/meta-ads-deep-sync.js', () => ({
    // LEVEL_FIELDS is statically imported by meta-ads-sync.js (it used to be a
    // per-call dynamic import), so the mock must supply it too.
    LEVEL_FIELDS: { adset: 'campaign_id,adset_id', ad: 'campaign_id,adset_id,ad_id' },
    syncMetaDeep: vi.fn(async () => ({ counts: { meta_adset: 4 }, skipped: [] })),
}));

const { syncOneOrg: syncOneGoogleOrg } = await import('../src/lib/integrations/google-ads-sync.js');
const { syncOneOrg: syncOneMetaOrg } = await import('../src/lib/integrations/meta-ads-sync.js');
const { integrationRepository } = await import('../src/repositories/integration.repository.js');
const { syncGoogleDeep, DEEP_WINDOW_DAYS } = await import('../src/lib/integrations/google-ads-deep-sync.js');
const { syncMetaDeep } = await import('../src/lib/integrations/meta-ads-deep-sync.js');
const { resetApiVersionCache } = await import('../src/lib/integrations/google-ads-version.js');

const ORG = '11111111-1111-1111-1111-111111111111';

const campaignBatch = [{ results: [{
    campaign: { id: 7, name: 'Implants' }, segments: { date: '2026-08-01' },
    customer: { descriptiveName: 'Acct', currencyCode: 'GBP' },
    metrics: { costMicros: '1000000', impressions: '10', clicks: '1', conversions: 1 },
}] }];

// Same generic response is reused for every Meta endpoint hit during
// syncOneOrg (campaign insights, account-period insights, campaign
// metadata) — matches the existing meta-ads-sync.test.mjs convention of one
// fetch stub serving every call; the endpoints that expect a different shape
// (campaigns metadata) simply find nothing to map and stay non-fatal.
const metaInsightsBody = {
    data: [{
        campaign_id: 7, campaign_name: 'Implants', date_start: '2026-08-01',
        spend: '10.00', impressions: '10', clicks: '1', actions: [],
    }],
    paging: {},
};

beforeEach(() => {
    resetApiVersionCache?.();
    supaRec.rpcCalls = [];
    supaRec.rpcProvider = () => ({ data: 1, error: null });
    syncGoogleDeep.mockClear();
    syncMetaDeep.mockClear();
    integrationRepository.getByProvider.mockReset();
    integrationRepository.markSynced.mockReset();
    integrationRepository.markFailed.mockReset();
    integrationRepository.listAdAccounts.mockReset();
    integrationRepository.listAdAccounts.mockResolvedValue([]);
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => campaignBatch }));
});

describe('google deep wiring', () => {
    beforeEach(() => {
        integrationRepository.getByProvider.mockResolvedValue({
            secrets: encryptSecret(JSON.stringify({ access_token: 'tok', refresh_token: 'r' })),
            config: { customer_ids: ['C1'] },
            expires_at: new Date(Date.now() + 3600_000).toISOString(),
        });
    });

    it('runs the deep pull with the 92-day window after the campaign replace', async () => {
        const expectedSince = londonDaysAgo(DEEP_WINDOW_DAYS);
        const res = await syncOneGoogleOrg(ORG);
        expect(syncGoogleDeep).toHaveBeenCalledTimes(1);
        const [orgArg, opts] = syncGoogleDeep.mock.calls[0];
        expect(orgArg).toBe(ORG);
        expect(opts.customerIds).toEqual(['C1']);
        // Proves the wiring goes through the SHARED DEEP_WINDOW_DAYS constant
        // (RULING D), not a per-provider hardcoded literal.
        expect(opts.since).toBe(expectedSince);
        // The upper bound matters as much as the lower one: it is the same
        // londonYmd() the campaign replace used, so the two grains cover the
        // identical window and the reconciliation panel cannot report a gap
        // that is really just a mismatched end date.
        expect(opts.until).toBe(londonYmd());

        expect(res.deep.counts).toEqual({ google_adgroup: 3 });
    });

    // "AFTER the campaign replace" was in the title above but asserted
    // nowhere — running the deep pull FIRST would have passed. Ordering is
    // load-bearing: the deep pull is wrapped so it can never fail the campaign
    // sync, and that wrapping only protects the day's spend if the campaign
    // replace has already committed by the time deep grain runs. Captured from
    // INSIDE the deep mock, which is the only place that can see what had
    // already happened at the moment it was called.
    it('runs the deep pull only once the campaign replace has already happened', async () => {
        let rpcsAtDeepTime = null;
        syncGoogleDeep.mockImplementationOnce(async () => {
            rpcsAtDeepTime = supaRec.rpcCalls.map((c) => c.fn);
            return { counts: { google_adgroup: 3 }, skipped: [] };
        });
        await syncOneGoogleOrg(ORG);
        expect(rpcsAtDeepTime).toContain('ad_metrics_replace_window');
    });

    // ========================================================================
    // A GRAIN THAT COMES BACK SHORT MUST REACH THE OWNER.
    //
    // This was the last silent case, and it is not hypothetical: three
    // ad-group pulls fell back to their base field set for a whole run because
    // the enriched query asked ad_group for a campaign-only metric. Every
    // count looked healthy, the integration stayed green, and the only symptom
    // was two columns quietly missing from one tab. It was found by reading a
    // sync's return value by hand — which is not a control.
    // ========================================================================
    it('warns when a single grain degrades to base fields, and says it will not self-heal', async () => {
        syncGoogleDeep.mockResolvedValueOnce({
            counts: { google_adgroup: 3 },
            skipped: [
                { customerId: 'c1', grain: 'google_adgroup:degraded', error: 'unsupported metric' },
                { customerId: 'c2', grain: 'google_adgroup:degraded', error: 'unsupported metric' },
            ],
        });
        await syncOneGoogleOrg(ORG);
        const warning = integrationRepository.markSynced.mock.calls.at(-1)[2];
        expect(warning).toMatch(/fell back to base fields/i);
        expect(warning).toContain('google_adgroup');
        // The distinguishing half: a degraded pull repeats every night, so the
        // wording must not read as a transient blip the next run will clear.
        expect(warning).toMatch(/until the query is fixed/i);
    });

    it('warns when a grain fails outright, and does NOT call that degraded', async () => {
        syncGoogleDeep.mockResolvedValueOnce({
            counts: {},
            skipped: [{ customerId: 'c1', grain: 'google_keyword', error: 'throttled' }],
        });
        await syncOneGoogleOrg(ORG);
        const warning = integrationRepository.markSynced.mock.calls.at(-1)[2];
        expect(warning).toMatch(/failed this run/i);
        expect(warning).toContain('google_keyword');
        expect(warning).not.toMatch(/fell back/i);
    });

    // The healthy path must stay silent, or a warning that fires every night
    // is a warning nobody reads.
    it('records no warning when every grain pulled cleanly', async () => {
        await syncOneGoogleOrg(ORG);
        const warning = integrationRepository.markSynced.mock.calls.at(-1)[2];
        expect(warning ?? null).toBeNull();
    });

    it('does not fail the campaign sync when the deep pull throws', async () => {
        syncGoogleDeep.mockRejectedValueOnce(new Error('keyword_view exploded'));
        const res = await syncOneGoogleOrg(ORG);
        expect(res.rows).toBeGreaterThan(0);
        expect(res.deep.error).toContain('keyword_view exploded');
        expect(integrationRepository.markSynced).toHaveBeenCalled();
    });

    // Currency comes from the LIVE Google stream (customer.currency_code), not
    // from a re-read of ad_accounts — so the fixture that drives this case is
    // the stream, exactly as in production. The re-read it replaced was
    // wrapped in `.catch(() => [])`, which made a database hiccup read every
    // currency as null; a null currency is deliberately treated as GBP, so the
    // guard FAILED OPEN on the very fault it exists to survive.
    it('skips a non-GBP account and reports it rather than converting', async () => {
        globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => [{ results: [{
            campaign: { id: 7, name: 'Implants' }, segments: { date: '2026-08-01' },
            customer: { descriptiveName: 'US Acct', currencyCode: 'USD' },
            metrics: { costMicros: '1000000', impressions: '10', clicks: '1', conversions: 1 },
        }] }] }));
        const res = await syncOneGoogleOrg(ORG);
        expect(res.deep.unsupportedCurrency).toEqual([{ customer_id: 'C1', currency: 'USD' }]);
        expect(syncGoogleDeep.mock.calls[0][1].customerIds).toEqual([]);
    });

    // The regression this pins directly: ad_accounts being unreadable must not
    // turn a USD account into a GBP one. listAdAccounts is made to REJECT, and
    // the guard must still refuse the account on the strength of the stream.
    it('still refuses a non-GBP account when the ad_accounts read fails', async () => {
        integrationRepository.listAdAccounts.mockRejectedValue(new Error('statement timeout'));
        globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => [{ results: [{
            campaign: { id: 7, name: 'Implants' }, segments: { date: '2026-08-01' },
            customer: { descriptiveName: 'US Acct', currencyCode: 'USD' },
            metrics: { costMicros: '1000000', impressions: '10', clicks: '1', conversions: 1 },
        }] }] }));
        const res = await syncOneGoogleOrg(ORG);
        expect(res.deep.unsupportedCurrency).toEqual([{ customer_id: 'C1', currency: 'USD' }]);
        expect(syncGoogleDeep.mock.calls[0][1].customerIds).toEqual([]);
    });
});

describe('meta deep wiring', () => {
    beforeEach(() => {
        integrationRepository.getByProvider.mockResolvedValue({
            secrets: encryptSecret(JSON.stringify({ access_token: 'tok' })),
            config: { account_ids: ['A1'] },
            expires_at: new Date(Date.now() + 30 * 86400_000).toISOString(),
        });
        globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => metaInsightsBody }));
    });

    it('runs the deep pull with the 92-day window after the campaign replace', async () => {
        const expectedSince = londonDaysAgo(DEEP_WINDOW_DAYS);
        const res = await syncOneMetaOrg(ORG);
        expect(syncMetaDeep).toHaveBeenCalledTimes(1);
        const [orgArg, opts] = syncMetaDeep.mock.calls[0];
        expect(orgArg).toBe(ORG);
        expect(opts.accountIds).toEqual(['A1']);
        // Proves the wiring goes through the SHARED DEEP_WINDOW_DAYS constant
        // (RULING D), not a per-provider hardcoded literal.
        expect(opts.since).toBe(expectedSince);
        expect(res.deep.counts).toEqual({ meta_adset: 4 });
    });

    it('does not fail the campaign sync when the deep pull throws', async () => {
        syncMetaDeep.mockRejectedValueOnce(new Error('adset insights exploded'));
        const res = await syncOneMetaOrg(ORG);
        expect(res.rows).toBeGreaterThan(0);
        expect(res.deep.error).toContain('adset insights exploded');
        expect(integrationRepository.markSynced).toHaveBeenCalled();
    });

    it('skips a non-GBP account and reports it rather than converting', async () => {
        integrationRepository.listAdAccounts.mockResolvedValue([
            { customer_id: 'A1', currency: 'USD', status: null },
        ]);
        const res = await syncOneMetaOrg(ORG);
        expect(res.deep.unsupportedCurrency).toEqual([{ customer_id: 'A1', currency: 'USD' }]);
        expect(syncMetaDeep.mock.calls[0][1].accountIds).toEqual([]);
    });
});
