// Meta Ads sync — decimal-string spend -> pence, conversion summing from the
// actions breakdown, insight parsing, and syncOneOrg delete-then-insert into
// ad_metrics keyed by organisation_id + provider='meta_ads' (multi-tenant).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supaRec } from './setup.js';
import { encryptSecret } from '../src/lib/crypto.js';

vi.mock('../src/repositories/integration.repository.js', () => ({
    integrationRepository: { upsert: vi.fn(), markFailed: vi.fn(), markSynced: vi.fn(), getByProvider: vi.fn(), upsertAdAccounts: vi.fn() },
}));

const { syncOneOrg, syncAllOrgs, __test } = await import('../src/lib/integrations/meta-ads-sync.js');
const { integrationRepository } = await import('../src/repositories/integration.repository.js');

// Window policy (product rule): nightly cron resyncs 3 months; on-connect /
// reconnect backfills 6 months. Guards against silent window regressions.
describe('sync windows', () => {
    it('nightly = 3 months, backfill = 6 months', () => {
        expect(__test.INCREMENTAL_DAYS).toBe(90);
        expect(__test.FULL_DAYS).toBe(183);
    });
});

const freshCreds = (account_ids) => ({
    secrets: encryptSecret(JSON.stringify({ access_token: 'tok' })),
    config: { account_ids },
    expires_at: new Date(Date.now() + 30 * 86400_000).toISOString(),
});

describe('spendToPence', () => {
    it('converts an account-currency decimal string to integer pence', () => {
        expect(__test.spendToPence('10.00')).toBe(1000);   // £10.00 -> 1000p
        expect(__test.spendToPence('1.2345')).toBe(123);   // £1.2345 -> 123p (rounded)
        expect(__test.spendToPence('0')).toBe(0);
        expect(__test.spendToPence(undefined)).toBe(0);
        expect(__test.spendToPence('not-a-number')).toBe(0);
    });
});

describe('conversionsFromActions', () => {
    it('sums values of conversion-type actions, ignoring others', () => {
        const actions = [
            { action_type: 'lead', value: '3' },
            { action_type: 'offsite_conversion.fb_pixel_lead', value: '2' },
            { action_type: 'link_click', value: '40' },      // not a conversion
            { action_type: 'purchase', value: '1' },
            { action_type: 'landing_page_view', value: '99' }, // not a conversion
        ];
        expect(__test.conversionsFromActions(actions)).toBe(6); // 3 + 2 + 1
    });
    it('handles missing / non-array input', () => {
        expect(__test.conversionsFromActions(undefined)).toBe(0);
        expect(__test.conversionsFromActions([])).toBe(0);
    });
});

describe('parseInsights', () => {
    it('maps insight rows, drops rows missing campaign_id/date_start', () => {
        const rows = [
            { campaign_id: 1, campaign_name: 'Implants', date_start: '2026-05-01',
              spend: '5.00', impressions: '1200', clicks: '40', reach: '900', frequency: '1.33',
              actions: [{ action_type: 'lead', value: '3' }] },
            { campaign_id: 2, date_start: '', spend: '1.00' }, // no date -> dropped
            { campaign_name: 'No id', date_start: '2026-05-02' }, // no id -> dropped
        ];
        // campaignMeta supplies status + objective (not on insights).
        const meta = { 1: { status: 'ACTIVE', objective: 'OUTCOME_LEADS' } };
        expect(__test.parseInsights(rows, meta)).toEqual([
            { campaign_id: '1', campaign_name: 'Implants', metric_date: '2026-05-01', spend_pence: 500,
              impressions: 1200, clicks: 40, reach: 900, frequency: 1.33,
              campaign_status: 'ACTIVE', objective: 'OUTCOME_LEADS', conversions: 3 },
        ]);
    });
    it('defaults reach to 0, frequency/status/objective to null when absent', () => {
        const rows = [{ campaign_id: 9, date_start: '2026-05-03', spend: '2.00', impressions: '100', clicks: '5' }];
        expect(__test.parseInsights(rows)).toEqual([
            { campaign_id: '9', campaign_name: null, metric_date: '2026-05-03', spend_pence: 200,
              impressions: 100, clicks: 5, reach: 0, frequency: null,
              campaign_status: null, objective: null, conversions: 0 },
        ]);
    });
    it('handles empty / non-array input', () => {
        expect(__test.parseInsights(undefined)).toEqual([]);
        expect(__test.parseInsights([])).toEqual([]);
    });
});

describe('parseAccountInsight', () => {
    it('maps an account-level (period, no time_increment) row to the snapshot shape', () => {
        // Meta returns ONE row for the whole window: reach is deduplicated unique
        // people and frequency is impressions/reach over the period — the numbers
        // you cannot rebuild by summing daily rows.
        const row = {
            reach: '168000', frequency: '3.9', impressions: '658907', clicks: '9036',
            spend: '6563.74', actions: [{ action_type: 'lead', value: '910' }],
        };
        expect(__test.parseAccountInsight(row)).toEqual({
            reach: 168000, frequency: 3.9, impressions: 658907, clicks: 9036,
            spend_pence: 656374, conversions: 910,
        });
    });
    it('defaults reach/impressions/clicks/spend to 0 and frequency to null when absent', () => {
        expect(__test.parseAccountInsight({})).toEqual({
            reach: 0, frequency: null, impressions: 0, clicks: 0, spend_pence: 0, conversions: 0,
        });
    });
    it('returns null for missing input', () => {
        expect(__test.parseAccountInsight(undefined)).toBeNull();
        expect(__test.parseAccountInsight(null)).toBeNull();
    });
});

describe('syncOneOrg', () => {
    beforeEach(() => {
        integrationRepository.upsert.mockReset();
        integrationRepository.markFailed.mockReset();
        integrationRepository.markSynced.mockReset();
        // The window replace now goes through the ad_metrics_replace_window RPC
        // (delete + upsert in one advisory-locked transaction). Stub it green.
        supaRec.rpcCalls = [];
        supaRec.rpcProvider = (fn) => fn === 'ad_metrics_replace_window'
            ? { data: 0, error: null }
            : { data: null, error: { message: `rpc ${fn} not stubbed` } };
    });

    it('pulls spend per account and replaces the org window in ad_metrics', async () => {
        const queries = [];
        supaRec.resultProvider = (q) => { queries.push(q); return { data: [], error: null }; };
        global.fetch = vi.fn(async () => ({
            ok: true, status: 200,
            json: async () => ({
                data: [
                    { campaign_id: 7, campaign_name: 'Brand', date_start: '2026-05-10',
                      spend: '3.00', impressions: '500', clicks: '20', actions: [{ action_type: 'lead', value: '2' }] },
                ],
                paging: {},
            }),
        }));

        const integration = {
            secrets: encryptSecret(JSON.stringify({ access_token: 'tok' })),
            config: { account_ids: ['1112223333'] },
            expires_at: new Date(Date.now() + 30 * 86400_000).toISOString(), // fresh -> no refresh
        };
        const res = await syncOneOrg('org-1', integration);

        expect(res.rows).toBe(1);
        expect(res.accounts).toBe(1);
        // The atomic replace runs in ONE advisory-locked RPC transaction (delete
        // + upsert), not a raw delete/upsert chain — that's what prevents the
        // overlapping-sync deadlock that surfaced as a statement timeout.
        const rpc = supaRec.rpcCalls.find((c) => c.fn === 'ad_metrics_replace_window');
        expect(rpc).toBeTruthy();
        expect(rpc.params).toMatchObject({ p_org: 'org-1', p_provider: 'meta_ads' });
        expect(rpc.params.p_customer_ids).toContain('1112223333');
        expect(rpc.params.p_rows).toEqual(expect.arrayContaining([
            expect.objectContaining({
                organisation_id: 'org-1', provider: 'meta_ads', customer_id: '1112223333',
                campaign_id: '7', spend_pence: 300, clicks: 20, conversions: 2,
            }),
        ]));
        expect(integrationRepository.markSynced).toHaveBeenCalled();
    });

    it('queries account-level period reach/frequency and writes it onto ad_accounts', async () => {
        const queries = [];
        supaRec.resultProvider = (q) => { queries.push(q); return { data: [], error: null }; };
        // time_increment=1 => daily campaign rows; no time_increment => the single
        // period row with deduplicated reach + period frequency.
        global.fetch = vi.fn(async (url) => {
            const isDaily = String(url).includes('time_increment=1');
            return {
                ok: true, status: 200,
                json: async () => ({
                    data: isDaily
                        ? [{ campaign_id: 7, campaign_name: 'Brand', date_start: '2026-05-10',
                             spend: '3.00', impressions: '500', clicks: '20', reach: '400', frequency: '1.25' }]
                        : [{ reach: '168000', frequency: '3.9', impressions: '658907', clicks: '9036', spend: '6563.74' }],
                    paging: {},
                }),
            };
        });

        const integration = {
            secrets: encryptSecret(JSON.stringify({ access_token: 'tok' })),
            config: { account_ids: ['1112223333'] },
            expires_at: new Date(Date.now() + 30 * 86400_000).toISOString(),
        };
        await syncOneOrg('org-1', integration);

        const snap = queries.find((q) => q.table === 'ad_accounts' && q.op === 'update');
        expect(snap, 'expected an ad_accounts period-snapshot update').toBeTruthy();
        expect(snap.updateVals).toMatchObject({ period_reach: 168000, period_frequency: 3.9, period_impressions: 658907 });
        expect(snap.eqs).toEqual(expect.arrayContaining([
            { col: 'organisation_id', val: 'org-1' },
            { col: 'provider', val: 'meta_ads' },
            { col: 'customer_id', val: '1112223333' },
        ]));
    });

    it('marks failed when no credentials are stored', async () => {
        const res = await syncOneOrg('org-1', { secrets: null });
        expect(res.error).toBe('no_auth');
        expect(integrationRepository.markFailed).toHaveBeenCalled();
    });

    // A 6-month backfill can be a few thousand rows. The whole window replace
    // (delete + upsert) goes through ONE advisory-locked RPC transaction so a
    // concurrent nightly sync can't deadlock it on ad_metrics row locks
    // ("canceling statement due to statement timeout"). It must NOT fall back to
    // a raw delete/chunked-upsert chain.
    it('sends the whole window through a single atomic replace RPC', async () => {
        const queries = [];
        supaRec.resultProvider = (q) => { queries.push(q); return { data: [], error: null }; };
        const data = Array.from({ length: 600 }, (_, i) => ({
            campaign_id: i + 1, campaign_name: `C${i}`, date_start: '2026-05-10',
            spend: '1.00', impressions: '1', clicks: '1',
        }));
        global.fetch = vi.fn(async (url) => {
            const isDaily = String(url).includes('time_increment=1');
            return { ok: true, status: 200, json: async () => ({ data: isDaily ? data : [], paging: {} }) };
        });

        const res = await syncOneOrg('org-1', freshCreds(['1112223333']));
        expect(res.rows).toBe(600);
        const replaces = supaRec.rpcCalls.filter((c) => c.fn === 'ad_metrics_replace_window');
        expect(replaces.length).toBe(1);                 // one atomic call, not N chunks
        expect(replaces[0].params.p_rows.length).toBe(600);
        // No raw delete/upsert chain on ad_metrics anymore.
        expect(queries.some((q) => q.table === 'ad_metrics' && (q.op === 'upsert' || q.op === 'delete'))).toBe(false);
    });

    it('marks failed when no ad accounts are connected', async () => {
        const integration = {
            secrets: encryptSecret(JSON.stringify({ access_token: 'tok' })),
            config: { account_ids: [] },
            expires_at: new Date(Date.now() + 30 * 86400_000).toISOString(),
        };
        await expect(syncOneOrg('org-1', integration)).rejects.toThrow(/accounts/);
        expect(integrationRepository.markFailed).toHaveBeenCalled();
    });

    // Robustness: an expired token makes EVERY account query throw. The sync must
    // NOT wipe the existing window and report healthy — mark failed and surface it.
    it('when every account errors: marks failed, throws, and does NOT delete existing rows', async () => {
        const queries = [];
        supaRec.resultProvider = (q) => { queries.push(q); return { data: [], error: null }; };
        global.fetch = vi.fn(async () => ({
            ok: false, status: 401,
            json: async () => ({ error: { message: 'Error validating access token: expired' } }),
        }));

        await expect(syncOneOrg('org-1', freshCreds(['1112223333']))).rejects.toThrow();
        expect(integrationRepository.markFailed).toHaveBeenCalled();
        expect(integrationRepository.markSynced).not.toHaveBeenCalled();   // never marked active
        // No replace (which deletes the window) when nothing was fetched.
        expect(supaRec.rpcCalls.find((c) => c.fn === 'ad_metrics_replace_window')).toBeUndefined();
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
            json: async () => ({ data: [], paging: {} }),   // 200 OK, no rows
        }));

        const res = await syncOneOrg('org-1', freshCreds(['1112223333']));
        expect(res.rows).toBe(0);
        // No replace (which deletes the window) on an empty-but-successful pull.
        expect(supaRec.rpcCalls.find((c) => c.fn === 'ad_metrics_replace_window')).toBeUndefined();
        expect(integrationRepository.markFailed).not.toHaveBeenCalled();
        expect(integrationRepository.markSynced).toHaveBeenCalled();        // healthy, just no new data
    });

    // Robustness: one bad account must not wipe the OTHER accounts' data. The
    // replace is scoped to the accounts that fetched rows.
    it('partial failure scopes the replace to successfully-fetched accounts', async () => {
        const queries = [];
        supaRec.resultProvider = (q) => { queries.push(q); return { data: [], error: null }; };
        global.fetch = vi.fn(async (url) => {
            const ok = String(url).includes('act_2220000000');
            return ok
                ? { ok: true, status: 200, json: async () => ({ data: [
                    { campaign_id: 7, campaign_name: 'Brand', date_start: '2026-05-10',
                      spend: '3.00', impressions: '500', clicks: '20', actions: [{ action_type: 'lead', value: '2' }] }],
                    paging: {} }) }
                : { ok: false, status: 403, json: async () => ({ error: { message: 'account disabled' } }) };
        });

        const res = await syncOneOrg('org-1', freshCreds(['1110000000', '2220000000']));
        expect(res.rows).toBe(1);
        const rpc = supaRec.rpcCalls.find((c) => c.fn === 'ad_metrics_replace_window');
        expect(rpc).toBeTruthy();
        expect(rpc.params.p_customer_ids).toEqual(['2220000000']);   // only the account that returned rows
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
        expect(q.eqs).toEqual(expect.arrayContaining([{ col: 'provider', val: 'meta_ads' }]));
        expect(q.ins).toEqual(expect.arrayContaining([{ col: 'status', vals: ['active', 'failed'] }]));
    });
});
