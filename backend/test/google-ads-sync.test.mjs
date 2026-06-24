// Google Ads sync — micros->pence conversion, searchStream parsing (camelCase
// JSON, batched results), and syncOneOrg delete-then-insert into ad_metrics
// keyed by organisation_id + provider='google_ads' (multi-tenant isolation).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supaRec } from './setup.js';
import { encryptSecret } from '../src/lib/crypto.js';

vi.mock('../src/repositories/integration.repository.js', () => ({
    integrationRepository: { upsert: vi.fn(), markFailed: vi.fn(), markSynced: vi.fn(), getByProvider: vi.fn(), upsertAdAccounts: vi.fn() },
}));

const { syncOneOrg, syncAllOrgs, __test } = await import('../src/lib/integrations/google-ads-sync.js');
const { integrationRepository } = await import('../src/repositories/integration.repository.js');

// Window policy (product rule): nightly cron resyncs 3 months; on-connect /
// reconnect backfills 6 months. Guards against silent window regressions.
describe('sync windows', () => {
    it('nightly = 3 months, backfill = 6 months', () => {
        expect(__test.INCREMENTAL_DAYS).toBe(90);
        expect(__test.FULL_DAYS).toBe(183);
    });
});

const freshCreds = (customer_ids) => ({
    secrets: encryptSecret(JSON.stringify({ access_token: 'tok', refresh_token: 'r' })),
    config: { customer_ids },
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
});

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
                { campaign: { id: 1, name: 'Implants', status: 'ENABLED', advertisingChannelType: 'SEARCH' },
                  segments: { date: '2026-05-01' }, customer: { descriptiveName: 'Smile Co', currencyCode: 'GBP' },
                  metrics: { costMicros: 5_000_000, impressions: 1200, clicks: 40, conversions: 3 } },
                { campaign: { id: 2 }, segments: {}, metrics: {} }, // no date -> dropped
            ] },
            { results: [
                { campaign: { id: 2, name: 'Whitening', status: 'PAUSED', advertisingChannelType: 'DISPLAY' },
                  segments: { date: '2026-05-02' },
                  metrics: { costMicros: 2_500_000, impressions: 800, clicks: 25, conversions: 1.6 } },
            ] },
        ];
        // Returns { rows, account } — account sniffed from the customer fields.
        expect(__test.parseSearchStream(batches)).toEqual({
            account: { name: 'Smile Co', currency: 'GBP' },
            rows: [
                { campaign_id: '1', campaign_name: 'Implants', metric_date: '2026-05-01', spend_pence: 500,
                  impressions: 1200, clicks: 40, reach: null, frequency: null,
                  campaign_status: 'ENABLED', objective: 'SEARCH', conversions: 3 },
                { campaign_id: '2', campaign_name: 'Whitening', metric_date: '2026-05-02', spend_pence: 250,
                  impressions: 800, clicks: 25, reach: null, frequency: null,
                  campaign_status: 'PAUSED', objective: 'DISPLAY', conversions: 2 },
            ],
        });
    });
    it('handles empty / non-array input', () => {
        expect(__test.parseSearchStream(undefined)).toEqual({ rows: [], account: null });
        expect(__test.parseSearchStream([])).toEqual({ rows: [], account: null });
    });
});

describe('syncOneOrg', () => {
    beforeEach(() => {
        integrationRepository.upsert.mockReset();
        integrationRepository.markFailed.mockReset();
        integrationRepository.markSynced.mockReset();
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
        const ins = queries.find((q) => q.table === 'ad_metrics' && q.op === 'upsert');
        expect(ins.upsertOpts).toMatchObject({ onConflict: 'organisation_id,provider,customer_id,campaign_id,metric_date' });
        expect(ins.upsertVals).toEqual(expect.arrayContaining([
            expect.objectContaining({
                organisation_id: 'org-1', provider: 'google_ads', customer_id: '1112223333',
                campaign_id: '7', spend_pence: 300, clicks: 20,
            }),
        ]));
        expect(integrationRepository.markSynced).toHaveBeenCalled();
    });

    it('marks failed when no credentials are stored', async () => {
        const res = await syncOneOrg('org-1', { secrets: null });
        expect(res.error).toBe('no_auth');
        expect(integrationRepository.markFailed).toHaveBeenCalled();
    });

    // A single multi-thousand-row upsert exceeds Postgres statement_timeout on
    // the 6-month backfill ("canceling statement due to statement timeout").
    // The upsert must be chunked into <=500-row batches.
    it('chunks a large upsert into <=500-row batches', async () => {
        const queries = [];
        supaRec.resultProvider = (q) => { queries.push(q); return { data: [], error: null }; };
        const results = Array.from({ length: 600 }, (_, i) => ({
            campaign: { id: i + 1, name: `C${i}` }, segments: { date: '2026-05-10' },
            metrics: { costMicros: 1_000_000, impressions: 1, clicks: 1, conversions: 0 },
        }));
        global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ([{ results }]) }));

        const res = await syncOneOrg('org-1', freshCreds(['1112223333']));
        expect(res.rows).toBe(600);
        const upserts = queries.filter((q) => q.table === 'ad_metrics' && q.op === 'upsert');
        expect(upserts.length).toBe(2); // 500 + 100
        expect(Math.max(...upserts.map((u) => u.upsertVals.length))).toBeLessThanOrEqual(500);
        expect(upserts.reduce((s, u) => s + u.upsertVals.length, 0)).toBe(600);
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

    // Robustness: a revoked/expired token makes EVERY customer query throw. The
    // sync must NOT wipe the existing window and report healthy — it must mark
    // failed and surface the error (so the nightly retry + UI see it).
    it('when every customer errors: marks failed, throws, and does NOT delete existing rows', async () => {
        const queries = [];
        supaRec.resultProvider = (q) => { queries.push(q); return { data: [], error: null }; };
        global.fetch = vi.fn(async () => ({
            ok: false, status: 401,
            json: async () => ({ error: { message: 'AUTHENTICATION_ERROR: token revoked' } }),
        }));

        await expect(syncOneOrg('org-1', freshCreds(['1112223333']))).rejects.toThrow();
        expect(integrationRepository.markFailed).toHaveBeenCalled();
        expect(integrationRepository.markSynced).not.toHaveBeenCalled();   // never marked active
        expect(queries.find((q) => q.table === 'ad_metrics' && q.op === 'delete')).toBeUndefined();
    });

    // Robustness: a 200 OK with an EMPTY result set (transient glitch — report
    // not ready, throttle, momentary access loss) must NOT be treated as "zero
    // spend" and wipe the existing window. Daily spend is immutable history; only
    // a non-empty pull may trigger a destructive replace.
    it('an empty (but successful) response does NOT delete existing rows and stays active', async () => {
        const queries = [];
        supaRec.resultProvider = (q) => { queries.push(q); return { data: [], error: null }; };
        global.fetch = vi.fn(async () => ({
            ok: true, status: 200,
            json: async () => ([{ results: [] }]),   // 200 OK, no rows
        }));

        const res = await syncOneOrg('org-1', freshCreds(['1112223333']));
        expect(res.rows).toBe(0);
        expect(queries.find((q) => q.table === 'ad_metrics' && q.op === 'delete')).toBeUndefined();
        expect(integrationRepository.markFailed).not.toHaveBeenCalled();
        expect(integrationRepository.markSynced).toHaveBeenCalled();        // healthy, just no new data
    });

    // Robustness: one bad account must not wipe the OTHER accounts' data. The
    // delete is scoped to the customers that fetched rows.
    it('partial failure scopes the delete to successfully-fetched customers', async () => {
        const queries = [];
        supaRec.resultProvider = (q) => { queries.push(q); return { data: [], error: null }; };
        global.fetch = vi.fn(async (url) => {
            const ok = String(url).includes('/customers/2220000000/');
            return ok
                ? { ok: true, status: 200, json: async () => ([
                    { results: [{ campaign: { id: 7, name: 'Brand' }, segments: { date: '2026-05-10' },
                      metrics: { costMicros: 3_000_000, impressions: 500, clicks: 20, conversions: 2 } }] }]) }
                : { ok: false, status: 403, json: async () => ({ error: { message: 'account disabled' } }) };
        });

        const res = await syncOneOrg('org-1', freshCreds(['1110000000', '2220000000']));
        expect(res.rows).toBe(1);
        const del = queries.find((q) => q.table === 'ad_metrics' && q.op === 'delete');
        expect(del).toBeTruthy();
        expect(del.ins).toEqual(expect.arrayContaining([{ col: 'customer_id', vals: ['2220000000'] }]));
        expect(integrationRepository.markSynced).toHaveBeenCalled();       // partial success still active
    });
});

// Nightly cron must also retry orgs stuck in 'failed' so a transient failure
// self-heals on the next run — never 'revoked' (the user disconnected those).
describe('syncAllOrgs', () => {
    it('selects active AND failed integrations (self-healing), not just active', async () => {
        const queries = [];
        supaRec.resultProvider = (q) => { queries.push(q); return { data: [], error: null }; };
        await syncAllOrgs();
        const q = queries.find((x) => x.table === 'integrations');
        expect(q.eqs).toEqual(expect.arrayContaining([{ col: 'provider', val: 'google_ads' }]));
        expect(q.ins).toEqual(expect.arrayContaining([{ col: 'status', vals: ['active', 'failed'] }]));
    });
});
