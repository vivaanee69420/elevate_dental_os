// The Integrations cards read `last_sync_at` off the `integrations` marker
// row, but GoHighLevel, QuickBooks and CallRail sync PER ACCOUNT and stamp the
// account row instead. Live proof this was wrong: GoHighLevel showed "synced
// 6d ago" and QuickBooks "86d ago" while their accounts had synced 2 hours and
// 17 hours earlier and 350 contacts, 360 leads and 1,330 financial rows had
// arrived that week.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import './setup.js';

vi.mock('../src/repositories/integration.repository.js', () => ({
  integrationRepository: { list: vi.fn(async () => []) },
}));
vi.mock('../src/repositories/integration-account.repository.js', () => ({
  integrationAccountRepository: { newestSyncByProvider: vi.fn(async () => new Map()) },
}));
vi.mock('../src/services/features.service.js', () => ({
  featuresService: { orgHasProviderFeature: vi.fn(async () => false) },
}));

const { integrationRepository } = await import('../src/repositories/integration.repository.js');
const { integrationAccountRepository } = await import('../src/repositories/integration-account.repository.js');
const { integrationService } = await import('../src/services/integration.service.js');

const ORG = 'org-1';

beforeEach(() => vi.clearAllMocks());

describe('integrationService.list — sync time reported to the cards', () => {
  it('reports the account sync when the marker row is stale', async () => {
    integrationRepository.list.mockResolvedValueOnce([
      { provider: 'gohighlevel', status: 'active', last_sync_at: '2026-08-31T12:02:49.334Z' },
    ]);
    integrationAccountRepository.newestSyncByProvider.mockResolvedValueOnce(
      new Map([['gohighlevel', '2026-09-06T17:07:14.999Z']]),
    );
    const { integrations } = await integrationService.list(ORG);
    expect(integrations[0].last_sync_at).toBe('2026-09-06T17:07:14.999Z');
  });

  it('never moves the reported time BACKWARDS when the marker row is newer', async () => {
    // A provider-level "Sync now" stamps the marker row and not the accounts,
    // so the parent legitimately leads. Taking the account time unconditionally
    // would age a sync that just finished.
    integrationRepository.list.mockResolvedValueOnce([
      { provider: 'quickbooks', status: 'active', last_sync_at: '2026-09-06T12:00:00.000Z' },
    ]);
    integrationAccountRepository.newestSyncByProvider.mockResolvedValueOnce(
      new Map([['quickbooks', '2026-06-12T12:24:42.809Z']]),
    );
    const { integrations } = await integrationService.list(ORG);
    expect(integrations[0].last_sync_at).toBe('2026-09-06T12:00:00.000Z');
  });

  it('leaves a provider with no accounts untouched', async () => {
    integrationRepository.list.mockResolvedValueOnce([
      { provider: 'emergent', status: 'active', last_sync_at: '2026-09-06T03:24:36.177Z' },
    ]);
    const { integrations } = await integrationService.list(ORG);
    expect(integrations[0].last_sync_at).toBe('2026-09-06T03:24:36.177Z');
  });

  it('fills in a marker row that has never synced at all', async () => {
    integrationRepository.list.mockResolvedValueOnce([
      { provider: 'callrail', status: 'active', last_sync_at: null },
    ]);
    integrationAccountRepository.newestSyncByProvider.mockResolvedValueOnce(
      new Map([['callrail', '2026-09-06T03:30:05.237Z']]),
    );
    const { integrations } = await integrationService.list(ORG);
    expect(integrations[0].last_sync_at).toBe('2026-09-06T03:30:05.237Z');
  });

  it('still lists the integrations when the account lookup fails', async () => {
    integrationRepository.list.mockResolvedValueOnce([
      { provider: 'gohighlevel', status: 'active', last_sync_at: '2026-08-31T12:02:49.334Z' },
    ]);
    integrationAccountRepository.newestSyncByProvider.mockRejectedValueOnce(new Error('boom'));
    const { integrations } = await integrationService.list(ORG);
    expect(integrations).toHaveLength(1);
    expect(integrations[0].last_sync_at).toBe('2026-08-31T12:02:49.334Z');
  });
});
