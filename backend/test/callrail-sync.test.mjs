// ============================================================================
// CallRail scheduled pull (Task 6).
//
// integrationAccountRepository and @sentry/node are vi.mock'd (mirrors
// gohighlevel-sync-resilience.test.mjs's resilience-suite shape) so this file
// is about callrail-sync.js's OWN orchestration: pagination termination,
// per-account failure isolation, the failed->retried set, and org/practice
// stamping. callrailRepository is used FOR REAL against the shared fake
// Supabase client (`supaRec`, test/setup.js) for the idempotency and
// cross-org tests, so those prove the actual upsert conflict target rather
// than just that a mock function was called.
// ============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supaRec } from './setup.js';
import { callrailRepository } from '../src/repositories/callrail.repository.js';
import { CALLRAIL_FIELDS } from '../src/lib/integrations/callrail-webhook.js';
import { londonDaysAgo } from '../src/lib/tz.js';

vi.mock('../src/repositories/integration-account.repository.js', () => ({
  integrationAccountRepository: {
    markSynced: vi.fn(async () => {}),
    markFailed: vi.fn(async () => {}),
    listAllSyncable: vi.fn(async () => []),
  },
}));

vi.mock('../src/lib/crypto.js', () => ({
  decryptSecret: () => JSON.stringify({ api_key: 'test-api-key' }),
  encryptSecret: (s) => 'enc:' + s,
}));

vi.mock('@sentry/node', () => ({
  captureException: vi.fn(),
  withScope: vi.fn((fn) => fn({ setTag: vi.fn(), setContext: vi.fn(), setLevel: vi.fn() })),
}));

import { integrationAccountRepository } from '../src/repositories/integration-account.repository.js';
import { syncAccount, syncAllOrgs, fetchAllCalls } from '../src/lib/integrations/callrail-sync.js';

const ORG_A = 'org-aaaa';
const ORG_B = 'org-bbbb';

// external_account_id is the CallRail COMPANY id; config.account_id is the
// CallRail ACCOUNT id that company lives under — deliberately two different
// values (see callrail-sync.js's file header on why conflating them was the
// root defect this integration shipped with).
function makeAccount(overrides = {}) {
  return {
    id: 'acc-1',
    organisation_id: ORG_A,
    provider: 'callrail',
    external_account_id: 'ACT1',
    practice_id: 'practice-1',
    label: 'Ashford',
    status: 'active',
    config: { account_id: 'ACC1' },
    secrets: 'enc:placeholder',
    ...overrides,
  };
}

function page(rows, { hasNext = false, next = null } = {}) {
  return { has_next_page: hasNext, next_page: next, calls: rows };
}

beforeEach(() => {
  vi.clearAllMocks();
  supaRec.last = undefined;
  supaRec.resultProvider = () => ({ data: [], error: null });
});

// ============================================================================
// PAGINATION — termination condition is has_next_page, never row count.
// ============================================================================
describe('fetchAllCalls — pagination', () => {
  it('refuses to fetch without a date window — CallRail silently defaults to the last 7 DAYS', async () => {
    // No date parameters at all does not mean "everything": CallRail applies
    // date_range=recent, the previous seven days, and answers 200. A 90-day
    // nightly sync would quietly become a 7-day one with nothing to notice.
    await expect(fetchAllCalls('key', 'ACC1', 'ACT1', {})).rejects.toThrow(/requires start_date and end_date/);
    await expect(fetchAllCalls('key', 'ACC1', 'ACT1', { startDate: '2026-06-01' })).rejects.toThrow(/requires start_date and end_date/);
  });

  it('follows next_page across a short-then-full-then-short run and stops the instant has_next_page is false (asserts REQUEST COUNT)', async () => {
    const pages = [
      page([{ id: 'C1' }], { hasNext: true, next: 'p2' }), // SHORT page, has_next_page true -> must continue
      page(Array.from({ length: 250 }, (_, i) => ({ id: `C2-${i}` })), { hasNext: true, next: 'p3' }), // FULL (per_page) page, still has_next_page true -> must continue
      page([{ id: 'C3' }], { hasNext: false, next: null }), // has_next_page false -> must stop HERE, regardless of row count
    ];
    let n = 0;
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => pages[n++] }));

    const { calls, requests } = await fetchAllCalls('key', 'ACC1', 'ACT1', { startDate: '2026-06-01', endDate: '2026-09-01' });

    expect(requests).toBe(3);
    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(calls.length).toBe(1 + 250 + 1);
  });

  it('does NOT keep paging just because a page was full — stops on the FIRST page when has_next_page is false even at max per_page', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => page(Array.from({ length: 250 }, (_, i) => ({ id: `C-${i}` })), { hasNext: false, next: null }),
    }));
    const { calls, requests } = await fetchAllCalls('key', 'ACC1', 'ACT1', { startDate: '2026-06-01', endDate: '2026-09-01' });
    expect(requests).toBe(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(calls.length).toBe(250);
  });

  it('does NOT stop early just because a page was short — has_next_page true keeps it going', async () => {
    const pages = [
      page([{ id: 'C1' }], { hasNext: true, next: 'p2' }), // only 1 row, but more pages exist
      page([], { hasNext: false, next: null }), // CallRail's own empty-but-final page
    ];
    let n = 0;
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => pages[n++] }));
    const { calls, requests } = await fetchAllCalls('key', 'ACC1', 'ACT1', { startDate: '2026-06-01', endDate: '2026-09-01' });
    expect(requests).toBe(2);
    expect(calls.length).toBe(1);
  });

  it('requests the shared CALLRAIL_FIELDS list AND an explicit company_id on every page — the same constant the webhook re-fetch uses, plus the defence against an account-wide key', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => page([]) }));
    await fetchAllCalls('key', 'ACC1', 'ACT1', { startDate: '2026-06-01', endDate: '2026-09-01' });
    const calledUrl = new URL(global.fetch.mock.calls[0][0]);
    expect(calledUrl.pathname).toBe('/v3/a/ACC1/calls.json');
    expect(calledUrl.searchParams.get('fields')).toBe(CALLRAIL_FIELDS);
    expect(calledUrl.searchParams.get('relative_pagination')).toBe('true');
    expect(calledUrl.searchParams.get('company_id')).toBe('ACT1');
  });

  it('flags truncation and warns, naming the CallRail account id, when the pagination cap is hit with more data still waiting', async () => {
    // has_next_page is ALWAYS true here — this is the only way to reach the
    // cap in a test without a real 50k-call account. 200 mocked round trips
    // is still fast (no real network/timers).
    global.fetch = vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => page([{ id: 'C' }], { hasNext: true, next: 'still-more' }),
    }));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { requests, truncated } = await fetchAllCalls('key', 'ACC1', 'ACT1', { startDate: '2026-06-01', endDate: '2026-09-01' });

    expect(requests).toBe(200); // MAX_PAGES
    expect(truncated).toBe(true);
    const warned = warnSpy.mock.calls.some((args) => args.join(' ').includes('ACC1'));
    expect(warned).toBe(true);
    warnSpy.mockRestore();
  });

  it('does NOT flag truncation on a run that finishes naturally (has_next_page: false before the cap)', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => page([]) }));
    const { truncated } = await fetchAllCalls('key', 'ACC1', 'ACT1', { startDate: '2026-06-01', endDate: '2026-09-01' });
    expect(truncated).toBe(false);
  });
});

// ============================================================================
// opts.full WINDOW WIRING — was dead code (no caller ever passed it, so
// FULL_DAYS was unreachable and even a fresh reconnect only ever pulled the
// 90-day incremental window). callrail.service.js now passes { full: true }
// on the manual per-company sync and the one-off pull after adding a
// company; this proves syncAccount itself actually branches on the flag.
// ============================================================================
describe('opts.full — INCREMENTAL_DAYS vs FULL_DAYS window', () => {
  it('defaults to the 90-day INCREMENTAL window when opts.full is omitted', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => page([]) }));
    await syncAccount(ORG_A, makeAccount());
    const calledUrl = new URL(global.fetch.mock.calls[0][0]);
    expect(calledUrl.searchParams.get('start_date')).toBe(londonDaysAgo(90));
  });

  it('pulls the 183-day FULL window when opts.full is true', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => page([]) }));
    await syncAccount(ORG_A, makeAccount(), () => {}, { full: true });
    const calledUrl = new URL(global.fetch.mock.calls[0][0]);
    expect(calledUrl.searchParams.get('start_date')).toBe(londonDaysAgo(183));
  });
});

// ============================================================================
// SHARED IDENTITY — same write path, same conflict target as the webhook.
// ============================================================================
describe('shared identity with the webhook', () => {
  it('a call already ingested (e.g. by the webhook) is not duplicated when the pull re-fetches it — proven through the REAL upsert conflict target', async () => {
    const store = new Map();
    supaRec.resultProvider = (q) => {
      if (q.table === 'callrail_calls' && q.upsertVals !== undefined) {
        const rows = Array.isArray(q.upsertVals) ? q.upsertVals : [q.upsertVals];
        const out = [];
        for (const r of rows) {
          const key = `${r.organisation_id}|${r.callrail_id}`;
          const id = store.get(key)?.id ?? `row-${store.size + 1}`;
          store.set(key, { ...r, id });
          out.push({ id });
        }
        return { data: out, error: null };
      }
      return { data: [], error: null };
    };

    // What the webhook already wrote for this call (same shape parseCallPayload produces).
    await callrailRepository.upsertCalls(ORG_A, [{
      callrail_id: 'CAL-SAME', started_at: '2026-09-01T10:00:00Z',
      practice_id: 'practice-1', integration_account_id: 'acc-1',
    }]);
    expect(store.size).toBe(1);

    // The nightly pull re-fetches the SAME call.
    global.fetch = vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => page([{ id: 'CAL-SAME', start_time: '2026-09-01T10:00:00Z' }]),
    }));
    const result = await syncAccount(ORG_A, makeAccount());

    expect(store.size).toBe(1); // still one row
    expect(supaRec.last.upsertOpts.onConflict).toBe('organisation_id,callrail_id');
    expect(result.ingested).toBe(1);
  });
});

// ============================================================================
// RESILIENCE — one account failing must not stop the rest, and a failed
// account must be retried next run, not frozen out.
// ============================================================================
describe('resilience', () => {
  it('one account failing does not stop the rest, and reports the failure without swallowing it (Sentry + results)', async () => {
    integrationAccountRepository.listAllSyncable.mockResolvedValue([
      makeAccount({ id: 'acc-fail', organisation_id: ORG_A }),
      makeAccount({ id: 'acc-ok', organisation_id: ORG_B, practice_id: 'practice-2' }),
    ]);
    let n = 0;
    global.fetch = vi.fn(async () => {
      n += 1;
      if (n === 1) throw new Error('ECONNRESET');
      return { ok: true, status: 200, json: async () => page([]) };
    });
    const Sentry = await import('@sentry/node');

    const results = await syncAllOrgs();

    expect(results).toHaveLength(2);
    expect(results.find((r) => r.accountId === 'acc-fail').error).toMatch(/ECONNRESET/);
    expect(results.find((r) => r.accountId === 'acc-ok').error).toBeUndefined();
    expect(integrationAccountRepository.markFailed).toHaveBeenCalledWith(ORG_A, 'acc-fail', expect.any(String));
    expect(integrationAccountRepository.markSynced).toHaveBeenCalledWith(ORG_B, 'acc-ok');
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });

  it('a status:"failed" account IS retried, not frozen out — syncAccount only skips "revoked"', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => page([]) }));
    const result = await syncAccount(ORG_A, makeAccount({ status: 'failed' }));
    expect(result.skipped).toBeUndefined();
    expect(global.fetch).toHaveBeenCalled();
    expect(integrationAccountRepository.markSynced).toHaveBeenCalledWith(ORG_A, 'acc-1');
  });

  it('a revoked account is skipped outright — never fetched, never marked synced', async () => {
    global.fetch = vi.fn();
    const result = await syncAccount(ORG_A, makeAccount({ status: 'revoked' }));
    expect(result.skipped).toBe('inactive');
    expect(global.fetch).not.toHaveBeenCalled();
    expect(integrationAccountRepository.markSynced).not.toHaveBeenCalled();
  });

  it('listAllSyncable selects status IN (active, failed) — never active alone (the pool syncAllOrgs actually pulls from)', async () => {
    integrationAccountRepository.listAllSyncable.mockResolvedValue([
      makeAccount({ id: 'acc-active', status: 'active' }),
      makeAccount({ id: 'acc-failed', status: 'failed', organisation_id: ORG_B }),
    ]);
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => page([]) }));
    const results = await syncAllOrgs();
    expect(results.map((r) => r.accountId).sort()).toEqual(['acc-active', 'acc-failed']);
    expect(integrationAccountRepository.markSynced).toHaveBeenCalledWith(ORG_A, 'acc-active');
    expect(integrationAccountRepository.markSynced).toHaveBeenCalledWith(ORG_B, 'acc-failed');
  });

  it('skips a company row with no CallRail ACCOUNT id on config — a company id alone is not enough to build a /v3/a/{...} URL', async () => {
    global.fetch = vi.fn();
    const result = await syncAccount(ORG_A, makeAccount({ config: {} }));
    expect(result.skipped).toBe('no_credentials');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

// ============================================================================
// ACCOUNT vs COMPANY — every /v3/a/{...} URL uses config.account_id (the
// CallRail ACCOUNT), never external_account_id (the CallRail COMPANY); and
// calls.json is filtered by company_id so an account-wide key cannot pull
// another company's calls under this practice.
// ============================================================================
describe('account vs company URLs, and the company_id defence in depth', () => {
  it('calls.json is built against the ACCOUNT id, filtered to the COMPANY id — never the reverse', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => page([]) }));
    await syncAccount(ORG_A, makeAccount({ config: { account_id: 'ACC-REAL' }, external_account_id: 'COM-REAL' }));
    const calledUrl = new URL(global.fetch.mock.calls[0][0]);
    expect(calledUrl.pathname).toBe('/v3/a/ACC-REAL/calls.json');
    expect(calledUrl.searchParams.get('company_id')).toBe('COM-REAL');
  });

  it('drops a call whose company_id disagrees with this row\'s company, counts and logs the drop once, and never writes it', async () => {
    const store = new Map();
    supaRec.resultProvider = (q) => {
      if (q.table === 'callrail_calls' && q.upsertVals !== undefined) {
        const rows = Array.isArray(q.upsertVals) ? q.upsertVals : [q.upsertVals];
        for (const r of rows) store.set(`${r.organisation_id}|${r.callrail_id}`, r);
        return { data: rows.map(() => ({ id: 'x' })), error: null };
      }
      return { data: [], error: null };
    };
    global.fetch = vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => page([
        { id: 'CAL-MINE', start_time: '2026-09-01T09:00:00Z', company_id: 'ACT1' },
        { id: 'CAL-OTHER', start_time: '2026-09-01T09:00:00Z', company_id: 'SOME-OTHER-COMPANY' },
      ]),
    }));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await syncAccount(ORG_A, makeAccount());

    expect(result.ingested).toBe(1);
    expect(result.fetched).toBe(2);
    expect(store.has(`${ORG_A}|CAL-MINE`)).toBe(true);
    expect(store.has(`${ORG_A}|CAL-OTHER`)).toBe(false);
    const warned = warnSpy.mock.calls.some((args) => args.join(' ').includes('dropped 1'));
    expect(warned).toBe(true);
    warnSpy.mockRestore();
  });

  it('company_id is never written as a callrail_calls column — even a matching one is stripped before the upsert', async () => {
    let captured;
    supaRec.resultProvider = (q) => {
      if (q.table === 'callrail_calls' && q.upsertVals !== undefined) {
        captured = Array.isArray(q.upsertVals) ? q.upsertVals : [q.upsertVals];
        return { data: captured.map(() => ({ id: 'x' })), error: null };
      }
      return { data: [], error: null };
    };
    global.fetch = vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => page([{ id: 'CAL-1', start_time: '2026-09-01T09:00:00Z', company_id: 'ACT1' }]),
    }));
    await syncAccount(ORG_A, makeAccount());
    expect(captured[0]).not.toHaveProperty('company_id');
  });

  it('a call with no company_id at all is trusted (not dropped) — the field is opportunistic, not required', async () => {
    const store = new Map();
    supaRec.resultProvider = (q) => {
      if (q.table === 'callrail_calls' && q.upsertVals !== undefined) {
        const rows = Array.isArray(q.upsertVals) ? q.upsertVals : [q.upsertVals];
        for (const r of rows) store.set(`${r.organisation_id}|${r.callrail_id}`, r);
        return { data: rows.map(() => ({ id: 'x' })), error: null };
      }
      return { data: [], error: null };
    };
    global.fetch = vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => page([{ id: 'CAL-1', start_time: '2026-09-01T09:00:00Z' }]),
    }));
    const result = await syncAccount(ORG_A, makeAccount());
    expect(result.ingested).toBe(1);
    expect(store.has(`${ORG_A}|CAL-1`)).toBe(true);
  });
});

// ============================================================================
// CROSS-ORG ISOLATION — every row carries the ACCOUNT's org/practice, never
// a value from the API response, and never another account's org/practice.
// ============================================================================
describe('cross-org isolation', () => {
  it('a call is written only to the org and practice of the account that fetched it', async () => {
    const store = new Map();
    supaRec.resultProvider = (q) => {
      if (q.table === 'callrail_calls' && q.upsertVals !== undefined) {
        const rows = Array.isArray(q.upsertVals) ? q.upsertVals : [q.upsertVals];
        const out = [];
        for (const r of rows) {
          const key = `${r.organisation_id}|${r.callrail_id}`;
          store.set(key, r);
          out.push({ id: key });
        }
        return { data: out, error: null };
      }
      return { data: [], error: null };
    };

    global.fetch = vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => page([{ id: 'CAL-A', start_time: '2026-09-01T09:00:00Z' }]),
    }));
    await syncAccount(ORG_A, makeAccount({ id: 'acc-a', organisation_id: ORG_A, practice_id: 'practice-a' }));

    global.fetch = vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => page([{ id: 'CAL-B', start_time: '2026-09-01T09:00:00Z' }]),
    }));
    await syncAccount(ORG_B, makeAccount({ id: 'acc-b', organisation_id: ORG_B, practice_id: 'practice-b' }));

    const rowA = store.get(`${ORG_A}|CAL-A`);
    const rowB = store.get(`${ORG_B}|CAL-B`);
    expect(rowA.practice_id).toBe('practice-a');
    expect(rowA.integration_account_id).toBe('acc-a');
    expect(rowB.practice_id).toBe('practice-b');
    expect(rowB.integration_account_id).toBe('acc-b');
    expect(store.has(`${ORG_A}|CAL-B`)).toBe(false);
    expect(store.has(`${ORG_B}|CAL-A`)).toBe(false);
  });
});

// ============================================================================
// Missing id/start_time — shares parseCallPayload with the webhook, so a
// half-formed call from the pull is rejected the same way.
// ============================================================================
describe('rejects half-formed calls, same rule as the webhook', () => {
  it('a call missing start_time from the API is not upserted, and does not count toward ingested', async () => {
    const store = new Map();
    supaRec.resultProvider = (q) => {
      if (q.table === 'callrail_calls' && q.upsertVals !== undefined) {
        const rows = Array.isArray(q.upsertVals) ? q.upsertVals : [q.upsertVals];
        for (const r of rows) store.set(`${r.organisation_id}|${r.callrail_id}`, r);
        return { data: rows.map(() => ({ id: 'x' })), error: null };
      }
      return { data: [], error: null };
    };
    global.fetch = vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => page([{ id: 'CAL-OK', start_time: '2026-09-01T09:00:00Z' }, { id: 'CAL-BAD' }]),
    }));
    const result = await syncAccount(ORG_A, makeAccount());
    expect(result.ingested).toBe(1);
    expect(result.fetched).toBe(2);
    expect(store.has(`${ORG_A}|CAL-BAD`)).toBe(false);
  });
});
