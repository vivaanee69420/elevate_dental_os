import { describe, it, expect, vi, beforeEach } from 'vitest';

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
    listAllActive: vi.fn(async () => [account]),
  },
}));

vi.mock('../src/lib/crypto.js', () => ({
  decryptSecret: () => JSON.stringify({ access_token: 'pit-x' }),
  encryptSecret: (s) => 'enc:' + s,
}));

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
