// Regression: a long sync has silent stretches (bulk opportunity upserts,
// conversations) where the syncer emits no progress for minutes. The UI treats a
// frozen progress `at` as "the import stopped" after ~75s -> the classic "stuck
// at 99%". runWithHeartbeat must re-stamp `at` while the awaited run() is in
// flight so a healthy long pull never falsely reads as stalled, and must stop
// stamping once the run settles.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { runWithHeartbeat } from '../src/services/integration.service.js';
import { setProgress, getProgress, clearProgress } from '../src/lib/integrations/sync-progress.js';

const ORG = 'org-hb';
const PROVIDER = 'gohighlevel';

describe('runWithHeartbeat', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        clearProgress(ORG, PROVIDER);
    });
    afterEach(() => {
        vi.useRealTimers();
        clearProgress(ORG, PROVIDER);
    });

    it('re-stamps progress `at` while a silent run is in flight', async () => {
        setProgress(ORG, PROVIDER, { running: true, pct: 99, phase: 'opportunities', done: false });
        const before = getProgress(ORG, PROVIDER).at;

        // A run that finishes no progress events for ~2 minutes (well past the
        // UI's 75s stall threshold).
        let resolveRun;
        const slow = new Promise((r) => { resolveRun = r; });
        const wrapped = runWithHeartbeat(ORG, PROVIDER, () => slow);

        // Advance past two heartbeat intervals without the run emitting anything.
        await vi.advanceTimersByTimeAsync(50_000);
        const mid = getProgress(ORG, PROVIDER).at;
        expect(mid).toBeGreaterThan(before); // heartbeat kept `at` fresh

        resolveRun('done');
        const result = await wrapped;
        expect(result).toBe('done');
    });

    it('stops stamping once the run settles (no leaked interval)', async () => {
        setProgress(ORG, PROVIDER, { running: true, pct: 50, phase: 'contacts', done: false });
        await runWithHeartbeat(ORG, PROVIDER, async () => 'ok');
        // Mark done as the orchestrator would, then ensure the heartbeat is gone:
        setProgress(ORG, PROVIDER, { running: false, done: true });
        const settled = getProgress(ORG, PROVIDER).at;
        await vi.advanceTimersByTimeAsync(60_000);
        expect(getProgress(ORG, PROVIDER).at).toBe(settled); // no further stamps
    });

    it('does not stamp a run whose progress is no longer running', async () => {
        setProgress(ORG, PROVIDER, { running: false, pct: 100, done: true });
        const before = getProgress(ORG, PROVIDER).at;
        let resolveRun;
        const slow = new Promise((r) => { resolveRun = r; });
        const wrapped = runWithHeartbeat(ORG, PROVIDER, () => slow);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(getProgress(ORG, PROVIDER).at).toBe(before); // guard: running=false -> skip
        resolveRun();
        await wrapped;
    });
});
