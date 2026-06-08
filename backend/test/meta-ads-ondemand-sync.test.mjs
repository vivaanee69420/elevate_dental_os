// Regression: meta_ads must be wired into integrationService.ON_DEMAND_SYNCERS.
// It was added to the daily worker + provider but missed in the on-demand
// dispatch map, so the Refresh button and first-connect pull both failed
// (syncNow threw "Provider meta_ads does not support on-demand sync") and only
// the 02:50 cron ever pulled spend. Without the fix this test throws on dispatch.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const progress = vi.hoisted(() => ({ current: null }));
vi.mock('../src/lib/integrations/sync-progress.js', () => ({
    getProgress: vi.fn(() => progress.current),
    setProgress: vi.fn((_o, _p, patch) => { progress.current = { ...(progress.current || {}), ...patch, at: Date.now() }; }),
    clearProgress: vi.fn(() => { progress.current = null; }),
}));

// A connected meta_ads integration so syncNow gets past its connection check.
vi.mock('../src/repositories/integration.repository.js', () => ({
    integrationRepository: {
        getByProvider: vi.fn(async () => ({ provider: 'meta_ads', status: 'active', secrets: 'enc', last_sync_at: null })),
        upsert: vi.fn(),
        markFailed: vi.fn(),
    },
}));

const metaSyncSpy = vi.hoisted(() => vi.fn(async () => ({ rows: 12, accounts: 1, skipped: [] })));
vi.mock('../src/lib/integrations/meta-ads-sync.js', () => ({ syncOneOrg: metaSyncSpy }));

const { integrationService } = await import('../src/services/integration.service.js');

const ORG = 'org-1';

describe('integrationService.syncNow meta_ads dispatch', () => {
    beforeEach(() => {
        progress.current = null;
        metaSyncSpy.mockClear();
    });

    it('dispatches to the meta-ads syncer instead of throwing "does not support on-demand sync"', async () => {
        const res = await integrationService.syncNow(ORG, 'meta_ads');
        expect(metaSyncSpy).toHaveBeenCalledOnce();
        expect(res).toMatchObject({ ok: true, provider: 'meta_ads', rows: 12 });
    });
});
