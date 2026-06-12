import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub the dependency modules BEFORE importing the service.
vi.mock('../src/repositories/integration-account.repository.js', () => {
  const rows = [];
  return {
    integrationAccountRepository: {
      _rows: rows,
      list: vi.fn(async () => rows.map(({ secrets, ...r }) => r)),
      getById: vi.fn(async (org, id) => rows.find((r) => r.id === id) ?? null),
      markRevoked: vi.fn(async (org, id) => { const r = rows.find((x) => x.id === id); if (r) { r.status = 'revoked'; r.secrets = null; } }),
    },
  };
});

vi.mock('../src/lib/integrations/quickbooks-provider.js', () => ({
  QuickBooksProvider: { authorize: vi.fn(async () => ({ redirectUrl: 'https://appcenter.intuit.com/connect/oauth2?x=1' })) },
}));

vi.mock('../src/lib/integrations/quickbooks-sync.js', () => ({
  syncAccount: vi.fn(async () => ({ accountId: 'acc-1', lines: 3 })),
}));

vi.mock('../src/repositories/integration.repository.js', () => ({
  integrationRepository: { markRevoked: vi.fn(async () => {}) },
}));

vi.mock('../src/lib/integration-gating.js', () => ({ invalidate: vi.fn() }));

// Record serviceClient.delete() calls so the purge can be asserted.
const purged = [];
vi.mock('../src/lib/supabase.js', () => ({
  serviceClient: {
    from: (table) => {
      const ctx = { table, eqs: {} };
      const chain = {
        delete: () => chain,
        eq: (col, val) => { ctx.eqs[col] = val; if (col === 'integration_account_id') purged.push({ table, ...ctx.eqs }); return chain; },
      };
      // make the chain awaitable (resolves to { error: null })
      chain.then = (resolve) => resolve({ error: null });
      return chain;
    },
  },
}));

describe('quickbooksAccountService', () => {
  let svc, repo;
  beforeEach(async () => {
    vi.resetModules();
    purged.length = 0;
    repo = (await import('../src/repositories/integration-account.repository.js')).integrationAccountRepository;
    repo._rows.length = 0;
    svc = (await import('../src/services/quickbooks-account.service.js')).quickbooksAccountService;
  });

  it('connect returns the OAuth redirect URL', async () => {
    const out = await svc.connect('org-1');
    expect(out.redirectUrl).toContain('appcenter.intuit.com');
  });

  it('listAccounts decorates companies with realm_id + company_name, no secrets', async () => {
    repo._rows.push({
      id: 'acc-1', organisation_id: 'org-1', provider: 'quickbooks', status: 'active',
      external_account_id: 'realm-1', label: 'Acme Dental',
      config: { realm_id: 'realm-1', company_name: 'Acme Dental' }, secrets: 'enc',
    });
    const { accounts } = await svc.listAccounts('org-1');
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ id: 'acc-1', realm_id: 'realm-1', company_name: 'Acme Dental', status: 'active' });
    expect(accounts[0].secrets).toBeUndefined();
  });

  it('removeAccount revokes the row and purges all four QB tables for that account', async () => {
    repo._rows.push({ id: 'acc-1', organisation_id: 'org-1', provider: 'quickbooks', status: 'active', config: {} });
    const out = await svc.removeAccount('org-1', 'acc-1');
    expect(out.ok).toBe(true);
    expect(repo._rows[0].status).toBe('revoked');
    const tables = purged.map((p) => p.table).sort();
    expect(tables).toEqual(['bank_accounts', 'invoices', 'monthly_financials', 'payments']);
    expect(purged.every((p) => p.integration_account_id === 'acc-1' && p.organisation_id === 'org-1')).toBe(true);
  });

  it('removeAccount 404s an unknown account', async () => {
    await expect(svc.removeAccount('org-1', 'nope')).rejects.toThrow();
  });
});
