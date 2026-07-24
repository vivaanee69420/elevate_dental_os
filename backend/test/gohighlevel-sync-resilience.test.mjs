// ============================================================================
// GoHighLevel sync resilience — regression tests for the "5 of 7 subaccounts
// stuck on `failed`" production incident (July 2026).
//
// Two defects, one visible symptom:
//   1. ghlFetchUrl retried ONLY 429. A single transient non-429 response (the
//      incident was an intermittent 400 from GET /contacts/ — every stored
//      failing URL replayed 200 afterwards) aborted the whole account sync.
//   2. The worker selected `status = 'active'` only, so markFailed('failed')
//      permanently removed the account from every future nightly run. The badge
//      never cleared on its own; last_sync_at froze.
// Plus: per-account failures were swallowed into a results array, so Sentry
// (initialised, DSN set in prod) never saw them and the cron monitor stayed green.
// ============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

const account = {
  id: 'acc-1', organisation_id: 'org-1', status: 'active',
  external_account_id: 'L1', practice_id: 'prac-9', config: {}, secrets: 'enc',
};

vi.mock('../src/repositories/integration-account.repository.js', () => ({
  integrationAccountRepository: {
    getByIdWithSecrets: vi.fn(async () => ({ ...account })),
    mergeConfig: vi.fn(async () => ({})),
    markSynced: vi.fn(async () => {}),
    markFailed: vi.fn(async () => {}),
    listAllSyncable: vi.fn(async () => [{ ...account }]),
  },
}));

vi.mock('../src/lib/crypto.js', () => ({
  decryptSecret: () => JSON.stringify({ access_token: 'pit-x' }),
  encryptSecret: (s) => 'enc:' + s,
}));

vi.mock('@sentry/node', () => ({
  captureException: vi.fn(),
  withScope: vi.fn((fn) => fn({ setTag: vi.fn(), setContext: vi.fn(), setLevel: vi.fn() })),
}));

const ok = (body) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body) });
const bad = (status, body) => ({ ok: false, status, headers: { get: () => null }, json: async () => ({}), text: async () => body });

async function loadSync() {
  return import('../src/lib/integrations/gohighlevel-sync.js');
}

describe('GHL sync resilience', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.GHL_RETRY_BASE_MS = '1'; // keep backoff instant under test
  });

  it('retries a transient non-429 failure instead of failing the whole account', async () => {
    let n = 0;
    global.fetch = vi.fn(async () => {
      n++;
      if (n === 1) return bad(400, '{"message":"transient"}');
      return ok({ contacts: [], opportunities: [], pipelines: [], workflows: [], meta: {} });
    });
    const repo = (await import('../src/repositories/integration-account.repository.js')).integrationAccountRepository;
    const { syncAccount } = await loadSync();

    await expect(syncAccount('org-1', 'acc-1')).resolves.toBeTruthy();
    expect(repo.markFailed).not.toHaveBeenCalled();
    expect(repo.markSynced).toHaveBeenCalledWith('org-1', 'acc-1');
  });

  it('retries a transient network error instead of failing the whole account', async () => {
    let n = 0;
    global.fetch = vi.fn(async () => {
      n++;
      if (n === 1) throw new Error('ECONNRESET');
      return ok({ contacts: [], opportunities: [], meta: {} });
    });
    const repo = (await import('../src/repositories/integration-account.repository.js')).integrationAccountRepository;
    const { syncAccount } = await loadSync();

    await expect(syncAccount('org-1', 'acc-1')).resolves.toBeTruthy();
    expect(repo.markFailed).not.toHaveBeenCalled();
  });

  it('includes the GHL response body in the persisted error (not just the status)', async () => {
    global.fetch = vi.fn(async () => bad(400, '{"message":"locationId is invalid","statusCode":400}'));
    const repo = (await import('../src/repositories/integration-account.repository.js')).integrationAccountRepository;
    const { syncAccount } = await loadSync();

    await expect(syncAccount('org-1', 'acc-1')).rejects.toThrow(/locationId is invalid/);
    const persisted = repo.markFailed.mock.calls[0][2];
    expect(persisted).toMatch(/locationId is invalid/);
  });

  it('does NOT retry a genuine auth failure (401) — no point burning attempts', async () => {
    global.fetch = vi.fn(async () => bad(401, 'Unauthorized'));
    const { syncAccount } = await loadSync();
    await expect(syncAccount('org-1', 'acc-1')).rejects.toThrow(/401/);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('reports every per-account sync failure to Sentry', async () => {
    global.fetch = vi.fn(async () => bad(401, 'Unauthorized'));
    const Sentry = await import('@sentry/node');
    const { syncAllOrgs } = await loadSync();

    const results = await syncAllOrgs();
    expect(results[0].error).toBeTruthy();
    expect(Sentry.captureException).toHaveBeenCalled();
  });
});
