import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub the dependency modules BEFORE importing the service.
vi.mock('../src/repositories/integration-account.repository.js', () => {
  const rows = [];
  return {
    integrationAccountRepository: {
      _rows: rows,
      list: vi.fn(async () => rows.map(({ secrets, ...r }) => r)),
      getByLocation: vi.fn(async (org, prov, loc) => rows.find((r) => r.external_account_id === String(loc)) ?? null),
      getById: vi.fn(async (org, id) => rows.find((r) => r.id === id) ?? null),
      getByIdWithSecrets: vi.fn(async (org, id) => rows.find((r) => r.id === id) ?? null),
      insert: vi.fn(async (org, fields) => { const row = { id: 'acc-' + (rows.length + 1), organisation_id: org, ...fields }; rows.push(row); const { secrets, ...safe } = row; return safe; }),
      update: vi.fn(async (org, id, patch) => { const r = rows.find((x) => x.id === id); Object.assign(r, patch); const { secrets, ...safe } = r; return safe; }),
      markRevoked: vi.fn(async (org, id) => { const r = rows.find((x) => x.id === id); if (r) { r.status = 'revoked'; r.secrets = null; } }),
    },
  };
});

vi.mock('../src/lib/integrations/gohighlevel-sync.js', () => ({
  fetchLocation: vi.fn(async (token, loc) => {
    if (token === 'bad') throw new Error('GHL 401');
    return { id: loc, name: 'Smile Dental ' + loc };
  }),
  bootstrapAccount: vi.fn(async () => ({ contacts: 0, opportunities: 0 })),
}));

vi.mock('../src/repositories/integration.repository.js', () => ({
  integrationRepository: { upsert: vi.fn(async () => ({})), markRevoked: vi.fn(async () => {}) },
}));

vi.mock('../src/lib/integration-gating.js', () => ({ invalidate: vi.fn() }));

describe('ghlAccountService.addAccount', () => {
  let svc, repo;
  beforeEach(async () => {
    process.env.INTEGRATIONS_SECRET_KEY = 'test-secret-key';
    vi.resetModules();
    repo = (await import('../src/repositories/integration-account.repository.js')).integrationAccountRepository;
    repo._rows.length = 0;
    svc = (await import('../src/services/ghl-account.service.js')).ghlAccountService;
  });

  it('rejects an invalid token before persisting', async () => {
    await expect(svc.addAccount('org-1', { token: 'bad', locationId: 'L1', practiceId: 'p1' }))
      .rejects.toThrow();
    expect(repo._rows.length).toBe(0);
  });

  it('encrypts the token, stores a webhook_token, and mints a row', async () => {
    const out = await svc.addAccount('org-1', { token: 'pit-good', locationId: 'L1', practiceId: 'p1' });
    expect(out.id).toBeTruthy();
    expect(out.secrets).toBeUndefined();
    const row = repo._rows[0];
    expect(row.external_account_id).toBe('L1');
    expect(row.practice_id).toBe('p1');
    expect(row.webhook_token).toMatch(/[a-f0-9]{32,}/);
    expect(row.secrets).toBeTruthy();
    expect(row.secrets).not.toContain('pit-good');
  });

  it('rejects a duplicate location for the same org', async () => {
    await svc.addAccount('org-1', { token: 'pit-good', locationId: 'L1', practiceId: 'p1' });
    await expect(svc.addAccount('org-1', { token: 'pit-good', locationId: 'L1', practiceId: 'p2' }))
      .rejects.toThrow(/already connected/i);
  });
});
