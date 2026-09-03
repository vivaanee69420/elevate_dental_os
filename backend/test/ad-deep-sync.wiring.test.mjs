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
import { londonDaysAgo } from '../src/lib/tz.js';

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
    syncGoogleDeep: vi.fn(async () => ({ counts: { google_adgroup: 3 }, skipped: [] })),
}));
vi.mock('../src/lib/integrations/meta-ads-deep-sync.js', () => ({
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
        expect(res.deep.counts).toEqual({ google_adgroup: 3 });
    });

    it('does not fail the campaign sync when the deep pull throws', async () => {
        syncGoogleDeep.mockRejectedValueOnce(new Error('keyword_view exploded'));
        const res = await syncOneGoogleOrg(ORG);
        expect(res.rows).toBeGreaterThan(0);
        expect(res.deep.error).toContain('keyword_view exploded');
        expect(integrationRepository.markSynced).toHaveBeenCalled();
    });

    // RULING E: google-ads-sync.js calls listAdAccounts TWICE — once for the
    // permanent-skip list near the top, once in the new deep block. A
    // mockResolvedValueOnce here would only satisfy the FIRST call, leaving
    // the deep block's currency lookup reading the default (empty) list and
    // testing nothing. mockResolvedValue (no `Once`) answers BOTH calls.
    it('skips a non-GBP account and reports it rather than converting', async () => {
        integrationRepository.listAdAccounts.mockResolvedValue([
            { customer_id: 'C1', currency: 'USD', status: null },
        ]);
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
