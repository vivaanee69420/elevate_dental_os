// Google Ads sync — micros->pence conversion, searchStream parsing (camelCase
// JSON, batched results), and syncOneOrg delete-then-insert into ad_metrics
// keyed by organisation_id + provider='google_ads' (multi-tenant isolation).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supaRec } from './setup.js';
import { encryptSecret } from '../src/lib/crypto.js';

vi.mock('../src/repositories/integration.repository.js', () => ({
    integrationRepository: { upsert: vi.fn(), markFailed: vi.fn(), getByProvider: vi.fn() },
}));

const { syncOneOrg, __test } = await import('../src/lib/integrations/google-ads-sync.js');
const { integrationRepository } = await import('../src/repositories/integration.repository.js');

describe('microsToPence', () => {
    it('converts cost micros to integer pence', () => {
        expect(__test.microsToPence(10_000_000)).toBe(1000);   // £10.00 -> 1000p
        expect(__test.microsToPence(1_234_500)).toBe(123);     // £1.2345 -> 123p (rounded)
        expect(__test.microsToPence(0)).toBe(0);
        expect(__test.microsToPence(undefined)).toBe(0);
    });
});

describe('parseSearchStream', () => {
    it('flattens batched results, reads camelCase fields, drops rows missing id/date', () => {
        const batches = [
            { results: [
                { campaign: { id: 1, name: 'Implants' }, segments: { date: '2026-05-01' },
                  metrics: { costMicros: 5_000_000, impressions: 1200, clicks: 40, conversions: 3 } },
                { campaign: { id: 2 }, segments: {}, metrics: {} }, // no date -> dropped
            ] },
            { results: [
                { campaign: { id: 2, name: 'Whitening' }, segments: { date: '2026-05-02' },
                  metrics: { costMicros: 2_500_000, impressions: 800, clicks: 25, conversions: 1.6 } },
            ] },
        ];
        expect(__test.parseSearchStream(batches)).toEqual([
            { campaign_id: '1', campaign_name: 'Implants', metric_date: '2026-05-01', spend_pence: 500, impressions: 1200, clicks: 40, conversions: 3 },
            { campaign_id: '2', campaign_name: 'Whitening', metric_date: '2026-05-02', spend_pence: 250, impressions: 800, clicks: 25, conversions: 2 },
        ]);
    });
    it('handles empty / non-array input', () => {
        expect(__test.parseSearchStream(undefined)).toEqual([]);
        expect(__test.parseSearchStream([])).toEqual([]);
    });
});

describe('syncOneOrg', () => {
    beforeEach(() => {
        integrationRepository.upsert.mockReset();
        integrationRepository.markFailed.mockReset();
    });

    it('pulls spend per customer and replaces the org window in ad_metrics', async () => {
        const queries = [];
        supaRec.resultProvider = (q) => { queries.push(q); return { data: [], error: null }; };
        global.fetch = vi.fn(async () => ({
            ok: true, status: 200,
            json: async () => ([
                { results: [
                    { campaign: { id: 7, name: 'Brand' }, segments: { date: '2026-05-10' },
                      metrics: { costMicros: 3_000_000, impressions: 500, clicks: 20, conversions: 2 } },
                ] },
            ]),
        }));

        const integration = {
            secrets: encryptSecret(JSON.stringify({ access_token: 'tok', refresh_token: 'r' })),
            config: { customer_ids: ['1112223333'] },
            expires_at: new Date(Date.now() + 3600_000).toISOString(), // fresh -> no refresh
        };
        const res = await syncOneOrg('org-1', integration);

        expect(res.rows).toBe(1);
        expect(res.customers).toBe(1);
        const del = queries.find((q) => q.table === 'ad_metrics' && q.op === 'delete');
        expect(del.eqs).toEqual(expect.arrayContaining([
            { col: 'organisation_id', val: 'org-1' }, { col: 'provider', val: 'google_ads' },
        ]));
        const ins = queries.find((q) => q.table === 'ad_metrics' && q.op === 'insert');
        expect(ins.insertVals).toEqual(expect.arrayContaining([
            expect.objectContaining({
                organisation_id: 'org-1', provider: 'google_ads', customer_id: '1112223333',
                campaign_id: '7', spend_pence: 300, clicks: 20,
            }),
        ]));
        expect(integrationRepository.upsert).toHaveBeenCalled();
    });

    it('marks failed when no credentials are stored', async () => {
        const res = await syncOneOrg('org-1', { secrets: null });
        expect(res.error).toBe('no_auth');
        expect(integrationRepository.markFailed).toHaveBeenCalled();
    });

    it('marks failed when no accessible customers are connected', async () => {
        const integration = {
            secrets: encryptSecret(JSON.stringify({ access_token: 'tok' })),
            config: { customer_ids: [] },
            expires_at: new Date(Date.now() + 3600_000).toISOString(),
        };
        await expect(syncOneOrg('org-1', integration)).rejects.toThrow(/customers/);
        expect(integrationRepository.markFailed).toHaveBeenCalled();
    });
});
