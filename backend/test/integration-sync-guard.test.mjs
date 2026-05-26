// integration.service.syncNow concurrency guard — prevents two syncs for the
// same org+provider running at once. Two parallel runs share one in-memory
// progress key and their independent page counters interleave, making the UI
// progress bar jump backwards (page 300 -> 120 -> 302). The guard is the fix.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Control progress reads/writes so we can simulate "a run is already active".
const progress = vi.hoisted(() => ({ current: null }));
vi.mock('../src/lib/integrations/sync-progress.js', () => ({
    getProgress: vi.fn(() => progress.current),
    setProgress: vi.fn((_o, _p, patch) => { progress.current = { ...(progress.current || {}), ...patch, at: Date.now() }; }),
    clearProgress: vi.fn(() => { progress.current = null; }),
}));

// A connected dentally integration so syncNow gets past its connection check.
vi.mock('../src/repositories/integration.repository.js', () => ({
    integrationRepository: {
        getByProvider: vi.fn(async () => ({ provider: 'dentally', status: 'active', secrets: 'enc', last_sync_at: null })),
        upsert: vi.fn(),
        markFailed: vi.fn(),
    },
}));

// Spy the actual syncer so we can assert whether a run was started.
const syncSpy = vi.hoisted(() => vi.fn(async () => ({ patients: 1, appointments: 0, payments: 0 })));
vi.mock('../src/lib/integrations/dentally-sync.js', () => ({ syncOneOrg: syncSpy }));

const { integrationService } = await import('../src/services/integration.service.js');
const { setProgress } = await import('../src/lib/integrations/sync-progress.js');

const ORG = 'org-1';

describe('integrationService.syncNow concurrency guard', () => {
    beforeEach(() => {
        progress.current = null;
        syncSpy.mockClear();
        setProgress.mockClear();
    });

    it('skips a second sync while one is actively running (returns alreadyRunning, syncer not called)', async () => {
        progress.current = { running: true, at: Date.now() }; // a fresh run is in flight
        const res = await integrationService.syncNow(ORG, 'dentally');
        expect(res).toMatchObject({ alreadyRunning: true, provider: 'dentally' });
        expect(syncSpy).not.toHaveBeenCalled();
    });

    it('starts a sync when none is running', async () => {
        progress.current = null;
        const res = await integrationService.syncNow(ORG, 'dentally');
        expect(res.alreadyRunning).toBeUndefined();
        expect(syncSpy).toHaveBeenCalledOnce();
    });

    it('ignores a STALE running flag (crashed sync must not wedge future syncs)', async () => {
        // running:true but last stamped 11 min ago — older than the 10-min staleness window.
        progress.current = { running: true, at: Date.now() - 11 * 60 * 1000 };
        const res = await integrationService.syncNow(ORG, 'dentally');
        expect(res.alreadyRunning).toBeUndefined();
        expect(syncSpy).toHaveBeenCalledOnce();
    });

    it('resets page/totalPages when a new run starts (no leftover page number from the prior run)', async () => {
        progress.current = { running: false, done: true, page: 999, totalPages: 999 };
        await integrationService.syncNow(ORG, 'dentally');
        const startCall = setProgress.mock.calls.find((c) => c[2]?.phase === 'starting');
        expect(startCall?.[2]).toMatchObject({ running: true, page: 0, totalPages: null });
    });
});
