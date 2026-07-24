import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const account = {
  id: 'acc-1', organisation_id: 'org-1', status: 'active',
  external_account_id: 'L1', practice_id: 'prac-9', config: {},
};

vi.mock('../src/repositories/integration-account.repository.js', () => ({
  integrationAccountRepository: {
    getByIdWithSecrets: vi.fn(async () => account),
    mergeConfig: vi.fn(async () => ({})),
    markSynced: vi.fn(async () => {}),
    markFailed: vi.fn(async () => {}),
    listAllSyncable: vi.fn(async () => [account]),
  },
}));

vi.mock('../src/lib/crypto.js', () => ({
  decryptSecret: () => JSON.stringify({ access_token: 'pit-x' }),
  encryptSecret: (s) => 'enc:' + s,
}));

// The conversations phase is exercised for its call contract (since +
// integrationAccountId), not its internals — those live in
// gohighlevel-conversations.test.mjs.
vi.mock('../src/lib/integrations/gohighlevel-conversations.js', () => ({
  syncConversations: vi.fn(async () => ({ conversations: 0, messages: 0 })),
}));

// Routes GHL API calls for a full syncAccount pass; every phase gets an empty
// (or provided) payload so the run reaches its end.
function ghlFetchRouter({ contacts = [], opportunities = [] } = {}) {
  return vi.fn(async (url) => {
    const u = String(url);
    const json = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => '' });
    if (u.includes('/opportunities/pipelines')) return json({ pipelines: [] });
    if (u.includes('/opportunities/search')) return json({ opportunities });
    if (u.includes('/contacts/')) return json({ contacts });
    if (u.includes('/workflows')) return json({ workflows: [] });
    if (u.includes('/calendars')) return json({ calendars: [] });
    return json({});
  });
}

describe('syncAccount', () => {
  beforeEach(() => { vi.resetModules(); account.secrets = 'enc'; });
  it('marks the account failed and rethrows when the pull errors', async () => {
    global.fetch = vi.fn(async () => { throw new Error('network'); });
    const repo = (await import('../src/repositories/integration-account.repository.js')).integrationAccountRepository;
    const { syncAccount } = await import('../src/lib/integrations/gohighlevel-sync.js');
    await expect(syncAccount('org-1', 'acc-1')).rejects.toThrow();
    expect(repo.markFailed).toHaveBeenCalledWith('org-1', 'acc-1', expect.any(String));
  });
  it('skips an inactive/secret-less account', async () => {
    const repo = (await import('../src/repositories/integration-account.repository.js')).integrationAccountRepository;
    repo.getByIdWithSecrets.mockResolvedValueOnce({ ...account, secrets: null });
    const { syncAccount } = await import('../src/lib/integrations/gohighlevel-sync.js');
    const r = await syncAccount('org-1', 'acc-1');
    expect(r.skipped).toBeTruthy();
  });
});

describe('syncAccount incremental window', () => {
  beforeEach(() => {
    vi.resetModules();
    account.secrets = 'enc';
    supaRec.resultProvider = () => ({ data: [], error: null });
  });

  it('routine run skips contacts and opportunities not updated since the last sync (24h margin)', async () => {
    account.last_sync_at = '2026-07-20T00:00:00.000Z';
    const leadUpserts = [];
    const contactBulkUpserts = [];
    supaRec.resultProvider = (q) => {
      if (q.table === 'leads' && q.op === 'upsert') { leadUpserts.push(q.upsertVals); return { data: null, error: null }; }
      // Chained .select() after .upsert() rewrites q.op, so detect upserts by
      // their recorded values instead.
      if (q.table === 'contacts' && q.upsertVals) {
        if (Array.isArray(q.upsertVals)) contactBulkUpserts.push(...q.upsertVals);
        return { data: { id: 'c-new' }, error: null };
      }
      // null (not []) so maybeSingle() lookups read as "no existing contact".
      if (q.table === 'contacts') return { data: null, error: null };
      return { data: [], error: null };
    };
    global.fetch = ghlFetchRouter({
      contacts: [
        { id: 'gc-old', firstName: 'Old', dateUpdated: '2026-07-01T00:00:00Z' },
        { id: 'gc-new', firstName: 'New', dateUpdated: '2026-07-21T00:00:00Z' },
      ],
      opportunities: [
        { id: 'opp-old', updatedAt: '2026-07-01T00:00:00Z', name: 'Old', contact: { id: 'g-old' } },
        { id: 'opp-new', updatedAt: '2026-07-21T00:00:00Z', name: 'New', contact: { id: 'g-new' } },
      ],
    });
    const { syncAccount } = await import('../src/lib/integrations/gohighlevel-sync.js');
    await syncAccount('org-1', 'acc-1');
    expect(contactBulkUpserts.map((c) => c.ghl_contact_id)).toEqual(['gc-new']);
    expect(leadUpserts.map((l) => l.ghl_opportunity_id)).toEqual(['opp-new']);
  });

  it('routine run passes the incremental window and account identity to the conversations phase', async () => {
    account.last_sync_at = '2026-07-20T00:00:00.000Z';
    global.fetch = ghlFetchRouter();
    const { syncAccount } = await import('../src/lib/integrations/gohighlevel-sync.js');
    const { syncConversations } = await import('../src/lib/integrations/gohighlevel-conversations.js');
    const r = await syncAccount('org-1', 'acc-1');
    expect(syncConversations).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ config: expect.objectContaining({ locationId: 'L1' }) }),
      expect.objectContaining({
        integrationAccountId: 'acc-1',
        since: '2026-07-19T00:00:00.000Z', // last_sync_at minus the 24h safety margin
      }),
    );
    expect(r).toMatchObject({ conversations: 0, messages: 0 });
  });

  it('first-ever run (no last_sync_at) uses no window — full bounded pull, conversations included', async () => {
    account.last_sync_at = null;
    global.fetch = ghlFetchRouter();
    const { syncAccount } = await import('../src/lib/integrations/gohighlevel-sync.js');
    const { syncConversations } = await import('../src/lib/integrations/gohighlevel-conversations.js');
    await syncAccount('org-1', 'acc-1');
    expect(syncConversations).toHaveBeenCalledWith(
      'org-1', expect.anything(),
      expect.objectContaining({ integrationAccountId: 'acc-1', since: null }),
    );
  });

  it('a conversations-phase failure does not fail the account sync', async () => {
    account.last_sync_at = '2026-07-20T00:00:00.000Z';
    global.fetch = ghlFetchRouter();
    const { syncConversations } = await import('../src/lib/integrations/gohighlevel-conversations.js');
    syncConversations.mockRejectedValueOnce(new Error('conversations scope missing'));
    const repo = (await import('../src/repositories/integration-account.repository.js')).integrationAccountRepository;
    const { syncAccount } = await import('../src/lib/integrations/gohighlevel-sync.js');
    const r = await syncAccount('org-1', 'acc-1');
    expect(repo.markSynced).toHaveBeenCalled();
    expect(repo.markFailed).not.toHaveBeenCalled();
    expect(r.conversations).toBe(0);
  });
});
