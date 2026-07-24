import { describe, it, expect, vi, beforeEach } from 'vitest';

const account = { id: 'acc-1', organisation_id: 'org-1', status: 'active', external_account_id: 'L1', practice_id: 'prac-9', config: {} };

vi.mock('../src/repositories/integration-account.repository.js', () => ({
  integrationAccountRepository: {
    getByWebhookToken: vi.fn(async (t) => (t === 'wht-good' ? account : null)),
    getByLocation: vi.fn(async () => account),
    list: vi.fn(async () => [account]),
  },
}));
vi.mock('../src/repositories/integration.repository.js', () => ({
  integrationRepository: { getByProvider: vi.fn(async () => ({ status: 'active', config: {} })) },
}));
const applied = [];
vi.mock('../src/lib/integrations/gohighlevel-sync.js', () => ({
  applyWebhookEvent: vi.fn(async (org, type, rec, integrationAccountId) => { applied.push({ org, type, integrationAccountId }); return { applied: 1 }; }),
  mapWebhookEventType: () => 'contact',
}));
vi.mock('../src/lib/integrations/dentally-sync.js', () => ({ applyWebhookEvent: vi.fn() }));

describe('GHL webhook account routing', () => {
  beforeEach(() => { applied.length = 0; account.status = 'active'; vi.resetModules(); });
  it('routes by per-account webhook_token and stamps that practice_id', async () => {
    const { webhookService } = await import('../src/services/webhook.service.js');
    const res = await webhookService.gohighlevel('wht-good', { type: 'ContactCreate', contact: { id: 'c1', email: 'a@x.com' } }, null);
    expect(res.received).toBe(true);
    expect(applied[0].org).toBe('org-1');
    expect(applied[0].integrationAccountId).toBe('acc-1');
  });

  // Pausing an org is done by flipping its accounts to 'revoked'. That has to
  // stop PUSHED events too, not just the nightly pull — otherwise a paused
  // subaccount keeps writing tenant data in real time.
  it('rejects an event for a revoked account and ingests nothing', async () => {
    account.status = 'revoked';
    const { webhookService } = await import('../src/services/webhook.service.js');
    await expect(
      webhookService.gohighlevel('wht-good', { type: 'ContactCreate', contact: { id: 'c1', email: 'a@x.com' } }, null),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(applied).toHaveLength(0);
  });
});
