// Google Ads sync — micros->pence conversion, searchStream parsing (camelCase
// JSON, batched results), and syncOneOrg delete-then-insert into ad_metrics
// keyed by organisation_id + provider='google_ads' (multi-tenant isolation).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supaRec } from './setup.js';
import { encryptSecret } from '../src/lib/crypto.js';

vi.mock('../src/repositories/integration.repository.js', () => ({
    integrationRepository: { upsert: vi.fn(), markFailed: vi.fn(), markSynced: vi.fn(), getByProvider: vi.fn(), upsertAdAccounts: vi.fn(), markAdAccountStatus: vi.fn(), listAdAccounts: vi.fn(async () => []), mergeConfig: vi.fn() },
}));

const { syncOneOrg, syncAllOrgs, __test } = await import('../src/lib/integrations/google-ads-sync.js');
const { integrationRepository } = await import('../src/repositories/integration.repository.js');
const { resetApiVersionCache } = await import('../src/lib/integrations/google-ads-version.js');

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
                  campaign_status: 'ENABLED', objective: 'SEARCH', conversions: 3,
                  conversions_value_pence: null, all_conversions: null, phone_calls: null,
                  search_impression_share: null, search_top_impression_share: null,
                  search_absolute_top_impression_share: null,
                  search_budget_lost_impression_share: null, search_rank_lost_impression_share: null },
                // FRACTIONAL, not rounded to 2: Google reports modelled
                // conversions as decimals, and ad_metrics.conversions is
                // numeric(14,2) (migration 000157) precisely so this figure
                // need not be forced to an integer before storage. Before
                // that fix this read Math.round(1.6) === 2, silently
                // disagreeing with the SAME campaign's conversions at
                // ad-group/ad/keyword grain, which were always stored exact.
                { campaign_id: '2', campaign_name: 'Whitening', metric_date: '2026-05-02', spend_pence: 250,
                  impressions: 800, clicks: 25, reach: null, frequency: null,
                  campaign_status: 'PAUSED', objective: 'DISPLAY', conversions: 1.6,
                  conversions_value_pence: null, all_conversions: null, phone_calls: null,
                  search_impression_share: null, search_top_impression_share: null,
                  search_absolute_top_impression_share: null,
                  search_budget_lost_impression_share: null, search_rank_lost_impression_share: null },
            ],
        });
    });
    // NULL, NEVER 0, for every enriched field Google did not report. This is
    // the whole assertion: ad_google_campaign_rollup filters its weighted
    // impression-share denominator on exactly this nullness, so a 0 would drag
    // every reported share downward, and a 0 conversion value would price a
    // campaign we cannot price at nothing. Display and Video campaigns do not
    // compete in the search auction at all, so a null share there is the
    // correct answer rather than a gap.
    it('carries conversion value, phone calls and all five impression shares when Google reports them', () => {
        const batches = [{ results: [
            { campaign: { id: 3, name: 'Emergency', status: 'ENABLED', advertisingChannelType: 'SEARCH' },
              segments: { date: '2026-06-01' },
              metrics: {
                  costMicros: 1_000_000, impressions: 100, clicks: 10, conversions: 2,
                  conversionsValue: 480.5, allConversions: 4.5, phoneCalls: 7,
                  searchImpressionShare: 0.55, searchTopImpressionShare: 0.30,
                  searchAbsoluteTopImpressionShare: 0.12,
                  searchBudgetLostImpressionShare: 0.31, searchRankLostImpressionShare: 0.14,
              } },
        ] }];
        const [row] = __test.parseSearchStream(batches).rows;
        // Value arrives in whole account-currency units, not micros — pence is
        // x100, not /10,000. Getting that backwards is off by 10,000x and
        // still looks like a plausible amount of money.
        expect(row.conversions_value_pence).toBe(48050);
        expect(row.all_conversions).toBe(4.5);
        expect(row.phone_calls).toBe(7);
        expect(row.search_impression_share).toBe(0.55);
        // The two that say WHY share was missed — the actionable half.
        expect(row.search_budget_lost_impression_share).toBe(0.31);
        expect(row.search_rank_lost_impression_share).toBe(0.14);
    });

    it('handles empty / non-array input', () => {
        expect(__test.parseSearchStream(undefined)).toEqual({ rows: [], account: null });
        expect(__test.parseSearchStream([])).toEqual({ rows: [], account: null });
    });

    // MAJOR 1: the sync path must never round Google's modelled conversions.
    // Pinned as its own test (not just the fixture above) so a regression
    // here fails with an unambiguous name rather than getting lost inside a
    // larger object-equality assertion.
    it('preserves a fractional conversions value exactly, never rounding it', () => {
        const batches = [{ results: [
            { campaign: { id: 9 }, segments: { date: '2026-06-01' },
              metrics: { costMicros: 1_000_000, impressions: 10, clicks: 1, conversions: 0.3 } },
        ] }];
        expect(__test.parseSearchStream(batches).rows[0].conversions).toBe(0.3);
    });
});

describe('syncOneOrg', () => {
    beforeEach(() => {
        integrationRepository.upsert.mockReset();
        integrationRepository.markFailed.mockReset();
        integrationRepository.markSynced.mockReset();
        integrationRepository.markAdAccountStatus.mockReset();
        integrationRepository.listAdAccounts.mockReset();
        integrationRepository.listAdAccounts.mockResolvedValue([]);
        // The window replace now goes through the ad_metrics_replace_window RPC
        // (delete + upsert in one advisory-locked transaction). Stub it green.
        supaRec.rpcCalls = [];
        supaRec.rpcProvider = (fn) => fn === 'ad_metrics_replace_window'
            ? { data: 0, error: null }
            : { data: null, error: { message: `rpc ${fn} not stubbed` } };
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
        // The atomic replace runs in ONE advisory-locked RPC transaction (delete
        // + upsert), not a raw delete/upsert chain — that's what prevents the
        // overlapping-sync deadlock that surfaced as a statement timeout.
        const rpc = supaRec.rpcCalls.find((c) => c.fn === 'ad_metrics_replace_window');
        expect(rpc).toBeTruthy();
        expect(rpc.params).toMatchObject({ p_org: 'org-1', p_provider: 'google_ads' });
        expect(rpc.params.p_customer_ids).toContain('1112223333');
        expect(rpc.params.p_rows).toEqual(expect.arrayContaining([
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

    // A 6-month backfill can be a few thousand rows. The whole window replace
    // (delete + upsert) goes through ONE advisory-locked RPC transaction so a
    // concurrent nightly sync can't deadlock it on ad_metrics row locks
    // ("canceling statement due to statement timeout"). It must NOT fall back to
    // a raw delete/chunked-upsert chain.
    it('sends the whole window through a single atomic replace RPC', async () => {
        const queries = [];
        supaRec.resultProvider = (q) => { queries.push(q); return { data: [], error: null }; };
        const results = Array.from({ length: 600 }, (_, i) => ({
            campaign: { id: i + 1, name: `C${i}` }, segments: { date: '2026-05-10' },
            metrics: { costMicros: 1_000_000, impressions: 1, clicks: 1, conversions: 0 },
        }));
        global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ([{ results }]) }));

        const res = await syncOneOrg('org-1', freshCreds(['1112223333']));
        expect(res.rows).toBe(600);
        const replaces = supaRec.rpcCalls.filter((c) => c.fn === 'ad_metrics_replace_window');
        expect(replaces.length).toBe(1);                 // one atomic call, not N chunks
        expect(replaces[0].params.p_rows.length).toBe(600);
        // No raw delete/upsert chain on ad_metrics anymore.
        expect(queries.some((q) => q.table === 'ad_metrics' && (q.op === 'upsert' || q.op === 'delete'))).toBe(false);
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
            json: async () => ([{ results: [] }]),   // 200 OK, no rows
        }));

        const res = await syncOneOrg('org-1', freshCreds(['1112223333']));
        expect(res.rows).toBe(0);
        // No replace (which deletes the window) on an empty-but-successful pull.
        expect(supaRec.rpcCalls.find((c) => c.fn === 'ad_metrics_replace_window')).toBeUndefined();
        expect(integrationRepository.markFailed).not.toHaveBeenCalled();
        expect(integrationRepository.markSynced).toHaveBeenCalled();        // healthy, just no new data
    });

    // Robustness: one bad account must not wipe the OTHER accounts' data. The
    // replace is scoped to the customers that fetched rows.
    it('partial failure scopes the replace to successfully-fetched customers', async () => {
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
        const rpc = supaRec.rpcCalls.find((c) => c.fn === 'ad_metrics_replace_window');
        expect(rpc).toBeTruthy();
        expect(rpc.params.p_customer_ids).toEqual(['2220000000']);   // only the customer that returned rows
        expect(integrationRepository.markSynced).toHaveBeenCalled();       // partial success still active
    });
});

// ---------------------------------------------------------------------------
// Permanently-unusable customers. listAccessibleCustomers returns EVERY account
// the login can reach — including the Manager (MCC) account itself, which can
// never serve metrics, and accounts that have been deactivated. Both were being
// re-queried on every nightly sync forever, and both surfaced as Google's
// generic "invalid argument" because queryCustomer only read error.message and
// never walked details[].errors[] for the real code.
// ---------------------------------------------------------------------------
describe('permanently-unusable customers', () => {
    it('classifies the two permanent Google error codes, and nothing else', () => {
        expect(__test.classifyCustomerError('Metrics cannot be requested for a manager account. (REQUESTED_METRICS_FOR_MANAGER)')).toBe('manager');
        expect(__test.classifyCustomerError("The customer account can't be accessed because it is not yet enabled or has been deactivated. (CUSTOMER_NOT_ENABLED)")).toBe('not_enabled');
        // A transient/unknown failure must stay retryable — marking it permanent
        // would silently drop a real account out of the sync forever.
        expect(__test.classifyCustomerError('Deadline exceeded')).toBeNull();
        expect(__test.classifyCustomerError('searchStream HTTP 500')).toBeNull();
        expect(__test.classifyCustomerError(undefined)).toBeNull();
    });

    it('marks a manager (MCC) account so it is not re-queried nightly', async () => {
        supaRec.resultProvider = () => ({ data: [], error: null });
        global.fetch = vi.fn(async (url) => String(url).includes('/customers/9990000000/')
            ? { ok: false, status: 400, json: async () => ([{ error: { message: 'Request contains an invalid argument.', details: [{ errors: [{ errorCode: { requestError: 'REQUESTED_METRICS_FOR_MANAGER' }, message: 'Metrics cannot be requested for a manager account.' }] }] } }]) }
            : { ok: true, status: 200, json: async () => ([{ results: [
                { campaign: { id: 7, name: 'Brand' }, segments: { date: '2026-05-10' },
                  metrics: { costMicros: 3_000_000, impressions: 500, clicks: 20, conversions: 2 } }] }]) });

        const res = await syncOneOrg('org-1', freshCreds(['9990000000', '1112223333']));

        expect(integrationRepository.markAdAccountStatus)
            .toHaveBeenCalledWith('org-1', 'google_ads', '9990000000', 'manager');
        // The good account still syncs — one bad account never sinks the run.
        expect(res.rows).toBe(1);
        expect(integrationRepository.markSynced).toHaveBeenCalled();
    });

    it('marks a deactivated account with the specific code, not a generic message', async () => {
        supaRec.resultProvider = () => ({ data: [], error: null });
        global.fetch = vi.fn(async (url) => String(url).includes('/customers/8880000000/')
            ? { ok: false, status: 403, json: async () => ([{ error: { message: 'Request contains an invalid argument.', details: [{ errors: [{ errorCode: { authorizationError: 'CUSTOMER_NOT_ENABLED' }, message: "The customer account can't be accessed because it is not yet enabled or has been deactivated." }] }] } }]) }
            : { ok: true, status: 200, json: async () => ([{ results: [
                { campaign: { id: 7, name: 'Brand' }, segments: { date: '2026-05-10' },
                  metrics: { costMicros: 3_000_000, impressions: 500, clicks: 20, conversions: 2 } }] }]) });

        const res = await syncOneOrg('org-1', freshCreds(['8880000000', '1112223333']));

        expect(integrationRepository.markAdAccountStatus)
            .toHaveBeenCalledWith('org-1', 'google_ads', '8880000000', 'not_enabled');
        // The skip reason carries the real Google code, not "invalid argument".
        expect(res.skipped.find((s) => s.cid === '8880000000').error).toContain('CUSTOMER_NOT_ENABLED');
    });

    it('skips already-marked customers WITHOUT issuing a request for them', async () => {
        supaRec.resultProvider = () => ({ data: [], error: null });
        integrationRepository.listAdAccounts.mockResolvedValueOnce([
            { customer_id: '9990000000', status: 'manager' },
            { customer_id: '8880000000', status: 'not_enabled' },
            { customer_id: '1112223333', status: null },
        ]);
        global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ([{ results: [
            { campaign: { id: 7, name: 'Brand' }, segments: { date: '2026-05-10' },
              metrics: { costMicros: 3_000_000, impressions: 500, clicks: 20, conversions: 2 } }] }]) }));

        const res = await syncOneOrg('org-1', freshCreds(['9990000000', '8880000000', '1112223333']));

        const urls = global.fetch.mock.calls.map((c) => String(c[0]));
        // No METRICS request for either — that is the doomed call this skip
        // list exists to prevent.
        expect(urls.some((u) => u.includes('/customers/9990000000/googleAds:searchStream'))).toBe(false);
        expect(urls.some((u) => u.includes('/customers/8880000000/googleAds:searchStream'))).toBe(false);
        expect(urls.some((u) => u.includes('/customers/1112223333/googleAds:searchStream'))).toBe(true);
        // The deactivated account is not probed for hierarchy either: it can
        // serve nothing. The manager IS probed — it serves no metrics but it is
        // the only route to its client accounts, and skipping that probe is how
        // two practices went six weeks with no data.
        expect(urls.some((u) => u.includes('/customers/8880000000/googleAds:search'))).toBe(false);
        expect(res.rows).toBe(1);
    });

    it('marks the integration failed when EVERY customer is permanently unusable', async () => {
        supaRec.resultProvider = () => ({ data: [], error: null });
        integrationRepository.listAdAccounts.mockResolvedValueOnce([
            { customer_id: '9990000000', status: 'manager' },
        ]);
        // An empty manager: the hierarchy probe answers, and answers with
        // nothing but the manager itself.
        global.fetch = vi.fn(async (url) => {
            const u = String(url);
            if (u.includes('customers:listAccessibleCustomers')) {
                return { ok: true, status: 200, json: async () => ({ resourceNames: ['customers/9990000000'] }) };
            }
            return { ok: true, status: 200, json: async () => ({ results: [
                { customerClient: { id: '9990000000', manager: true, level: '0' } },
            ] }) };
        });

        await expect(syncOneOrg('org-1', freshCreds(['9990000000']))).rejects.toThrow(/no usable/i);
        // Never silently reports healthy with zero rows pulled.
        expect(integrationRepository.markSynced).not.toHaveBeenCalled();
        // Probing the hierarchy is fine and necessary; asking a manager for
        // metrics is the doomed call, and it must not happen.
        const urls = global.fetch.mock.calls.map((c) => String(c[0]));
        expect(urls.some((u) => u.includes('googleAds:searchStream'))).toBe(false);
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

describe('API version self-heal (sunset version)', () => {
    it('searchStream 404 on a retired version advances to the next live version and still syncs rows', async () => {
        resetApiVersionCache();
        process.env.GOOGLE_ADS_API_VERSION = 'v25';
        supaRec.resultProvider = () => ({ data: [], error: null });
        const urls = [];
        global.fetch = vi.fn(async (url, init = {}) => {
            urls.push(String(url));
            const v = String(url).match(/\/(v\d+)\//)[1];
            const probe = !init.headers?.Authorization;
            if (probe) return { ok: false, status: v === 'v26' ? 401 : 404, json: async () => ({}) };
            if (v === 'v26') return { ok: true, status: 200, json: async () => ([
                { results: [{ campaign: { id: 7, name: 'Brand' }, segments: { date: '2026-08-20' },
                  metrics: { costMicros: 3_000_000, impressions: 500, clicks: 20, conversions: 2 } }] }]) };
            return { ok: false, status: 404, json: async () => ({}) };
        });
        const res = await syncOneOrg('org-1', freshCreds(['1110000000']));
        expect(res.rows).toBe(1);
        expect(urls.at(-1)).toMatch(/\/v26\/customers\/1110000000\/googleAds:searchStream$/);
        delete process.env.GOOGLE_ADS_API_VERSION;
    });
});

// Regression: an account reachable ONLY through a manager.
//
// listAccessibleCustomers names the accounts a Google login is linked to
// DIRECTLY. It does not name a manager's clients. When Ashford's and Barnet's
// access moved under the "GM Dental - Practice Accounts" MCC, both dropped out
// of that list, the sync stopped querying them entirely, and the integration
// went on reporting `active` for six weeks because the one account still linked
// directly kept returning rows. Nothing errored; the data simply stopped.
describe('accounts reachable only through a manager', () => {
    const MCC = '3325223529';
    const CHILD = '9010336897';

    // One mock standing in for three distinct Google endpoints.
    const googleMock = () => vi.fn(async (url, init) => {
        const u = String(url);
        if (u.includes('customers:listAccessibleCustomers')) {
            // The manager is the ONLY thing this credential is linked to.
            return { ok: true, status: 200, json: async () => ({ resourceNames: [`customers/${MCC}`] }) };
        }
        if (u.includes('googleAds:search') && !u.includes('searchStream')) {
            return { ok: true, status: 200, json: async () => ({ results: [
                { customerClient: { id: MCC, descriptiveName: 'GM Dental - Practice Accounts', manager: true, level: '0' } },
                { customerClient: { id: CHILD, descriptiveName: 'GM-Dental-Ashford', manager: false, level: '1', currencyCode: 'GBP' } },
            ] }) };
        }
        return { ok: true, status: 200, json: async () => ([{ results: [
            { campaign: { id: 7, name: 'Implants' }, segments: { date: '2026-05-10' },
              customer: { descriptiveName: 'GM-Dental-Ashford', currencyCode: 'GBP' },
              metrics: { costMicros: 3_000_000, impressions: 500, clicks: 20, conversions: 2 } },
        ] }]) };
    });

    it('pulls the child account and sends the manager as login-customer-id', async () => {
        supaRec.resultProvider = () => ({ data: [], error: null });
        global.fetch = googleMock();

        const res = await syncOneOrg('org-1', freshCreds([MCC]));

        // The child was queried at all — this is the whole bug.
        const streamCall = global.fetch.mock.calls
            .find(([u]) => String(u).includes(`/customers/${CHILD}/googleAds:searchStream`));
        expect(streamCall).toBeDefined();
        // ...and routed through the manager. Without this header Google answers
        // as though the account does not exist for this credential, so asserting
        // only that the request was made would pass against a broken pull.
        expect(streamCall[1].headers['login-customer-id']).toBe(MCC);
        expect(res.rows).toBe(1);
    });

    it('never asks for metrics on the manager itself', async () => {
        supaRec.resultProvider = () => ({ data: [], error: null });
        global.fetch = googleMock();

        await syncOneOrg('org-1', freshCreds([MCC]));

        const urls = global.fetch.mock.calls.map((c) => String(c[0]));
        expect(urls.some((u) => u.includes(`/customers/${MCC}/googleAds:searchStream`))).toBe(false);
    });

    it('persists the resolved account and its manager route for the next run', async () => {
        supaRec.resultProvider = () => ({ data: [], error: null });
        global.fetch = googleMock();

        await syncOneOrg('org-1', freshCreds([MCC]));

        expect(integrationRepository.mergeConfig).toHaveBeenCalledWith('org-1', 'google_ads',
            expect.objectContaining({ customer_logins: { [CHILD]: MCC } }));
    });
});

// The failure mode that hurt most was not an error — it was a green light.
// A sync that pulls only part of what it should must say so, or an owner has
// no way to tell "this practice spends nothing" from "we stopped asking".
describe('a partial pull is never recorded as a clean one', () => {
    const OK_STREAM = [{ results: [
        { campaign: { id: 7, name: 'Brand' }, segments: { date: '2026-05-10' },
          metrics: { costMicros: 3_000_000, impressions: 500, clicks: 20, conversions: 2 } },
    ] }];

    it('warns when a practice-mapped account is not in the pull set at all', async () => {
        supaRec.resultProvider = () => ({ data: [], error: null });
        // Barnet is mapped to a practice and carries no error status — it is
        // simply absent from the accessible list. Nothing about this run
        // throws, which is exactly why it went unnoticed.
        integrationRepository.listAdAccounts.mockResolvedValueOnce([
            { customer_id: '1112223333', status: null, practice_id: null, name: 'Rochester' },
            { customer_id: '6110644137', status: null, practice_id: 'prac-barnet', name: 'Barnet' },
        ]);
        global.fetch = vi.fn(async (url) => {
            const u = String(url);
            if (u.includes('customers:listAccessibleCustomers')) {
                return { ok: true, status: 200, json: async () => ({ resourceNames: ['customers/1112223333'] }) };
            }
            if (u.includes('googleAds:search') && !u.includes('searchStream')) {
                return { ok: true, status: 200, json: async () => ({ results: [
                    { customerClient: { id: '1112223333', manager: false, level: '0' } },
                ] }) };
            }
            return { ok: true, status: 200, json: async () => OK_STREAM };
        });

        const res = await syncOneOrg('org-1', freshCreds(['1112223333']));

        expect(res.unreachable).toContain('6110644137');
        const [, , warning] = integrationRepository.markSynced.mock.calls.at(-1);
        expect(warning).toMatch(/Barnet/);
        expect(warning).toMatch(/not reachable/i);
    });

    it('leaves no warning when every mapped account was pulled', async () => {
        supaRec.resultProvider = () => ({ data: [], error: null });
        integrationRepository.listAdAccounts.mockResolvedValueOnce([
            { customer_id: '1112223333', status: null, practice_id: 'prac-a', name: 'Rochester' },
        ]);
        global.fetch = vi.fn(async (url) => {
            const u = String(url);
            if (u.includes('customers:listAccessibleCustomers')) {
                return { ok: true, status: 200, json: async () => ({ resourceNames: ['customers/1112223333'] }) };
            }
            if (u.includes('googleAds:search') && !u.includes('searchStream')) {
                return { ok: true, status: 200, json: async () => ({ results: [
                    { customerClient: { id: '1112223333', manager: false, level: '0' } },
                ] }) };
            }
            return { ok: true, status: 200, json: async () => OK_STREAM };
        });

        await syncOneOrg('org-1', freshCreds(['1112223333']));

        // A warning on a healthy sync is as bad as silence on a broken one:
        // it teaches the owner to ignore the field.
        const [, , warning] = integrationRepository.markSynced.mock.calls.at(-1);
        expect(warning).toBeNull();
    });
});
