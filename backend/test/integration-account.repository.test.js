import { describe, it, expect, vi, beforeEach } from 'vitest';

// Minimal Supabase query-builder mock: records the last filter chain + returns canned data.
function makeClient(rows = []) {
  const state = { table: null, filters: {}, payload: null, op: null };
  const builder = {
    select() { return builder; },
    eq(col, val) { state.filters[col] = val; return builder; },
    order() { return builder; },
    maybeSingle() { return Promise.resolve({ data: rows[0] ?? null }); },
    single() { return Promise.resolve({ data: rows[0] ?? null, error: null }); },
    then(res) { return Promise.resolve({ data: rows, error: null }).then(res); },
    insert(p) { state.payload = p; state.op = 'insert'; return builder; },
    update(p) { state.payload = p; state.op = 'update'; return builder; },
  };
  return {
    state,
    from(table) { state.table = table; return builder; },
  };
}

describe('integrationAccountRepository', () => {
  let mod;
  beforeEach(async () => {
    vi.resetModules();
    mod = await import('../src/repositories/integration-account.repository.js');
  });

  it('list scopes by organisation_id and provider', async () => {
    const repo = mod.integrationAccountRepository;
    const client = makeClient([{ id: 'a1', provider: 'gohighlevel' }]);
    const spy = vi.spyOn(repo, '_client').mockReturnValue(client);
    const rows = await repo.list('org-1', 'gohighlevel');
    expect(spy).toHaveBeenCalled();
    expect(client.state.table).toBe('integration_accounts');
    expect(client.state.filters.organisation_id).toBe('org-1');
    expect(client.state.filters.provider).toBe('gohighlevel');
    expect(rows[0].id).toBe('a1');
  });

  it('list never selects the secrets column', async () => {
    const repo = mod.integrationAccountRepository;
    const client = makeClient([]);
    let selected = '';
    client.from = (t) => { client.state.table = t; return {
      select(cols) { selected = cols; return this; },
      eq() { return this; }, order() { return this; },
      then(r) { return Promise.resolve({ data: [], error: null }).then(r); },
    }; };
    vi.spyOn(repo, '_client').mockReturnValue(client);
    await repo.list('org-1', 'gohighlevel');
    expect(selected).not.toContain('secrets');
  });

  // Regression: the worker used to select status='active' only, so markFailed
  // permanently removed an account from every future nightly run — a single
  // transient GHL error froze the subaccount on a red "failed" badge forever.
  it('listAllSyncable includes failed accounts so they self-heal on the next run', async () => {
    const repo = mod.integrationAccountRepository;
    const state = { table: null, filters: {}, ins: {} };
    const builder = {
      select() { return builder; },
      eq(col, val) { state.filters[col] = val; return builder; },
      in(col, vals) { state.ins[col] = vals; return builder; },
      then(r) { return Promise.resolve({ data: [{ id: 'a1' }], error: null }).then(r); },
    };
    vi.spyOn(repo, '_client').mockReturnValue({ from(t) { state.table = t; return builder; } });

    await repo.listAllSyncable('gohighlevel');

    expect(state.table).toBe('integration_accounts');
    expect(state.filters.provider).toBe('gohighlevel');
    expect(state.ins.status).toEqual(['active', 'failed']);
    expect(state.ins.status).not.toContain('revoked');
  });
});
