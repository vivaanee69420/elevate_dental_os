import { describe, it, expect } from 'vitest';
import { spendFreshness } from '../src/lib/marketing/spend-freshness.js';

describe('spendFreshness', () => {
    // The real incident: the sync ran at 02:50 UTC on the 6th, so the 6th held
    // GBP 68.04 against a ~720 daily average and the report showed it as final.
    it('marks the sync\'s own day partial, because the sync ran part-way through it', () => {
        const f = spendFreshness({
            syncedAt: '2026-09-06T02:50:22Z',
            latestDay: '2026-09-06',
            until: '2026-09-06',
        });
        expect(f.completeTo).toBe('2026-09-05');
        expect(f.partial).toBe(true);
    });

    it('reports a window ending on the last final day as complete', () => {
        const f = spendFreshness({
            syncedAt: '2026-09-06T02:50:22Z',
            latestDay: '2026-09-06',
            until: '2026-09-05',
        });
        expect(f.completeTo).toBe('2026-09-05');
        expect(f.partial).toBe(false);
    });

    // A dead feed is a different failure from a mid-day one, and the data must
    // cap completeness rather than the clock.
    it('caps completeness at the newest row when the feed is stale', () => {
        const f = spendFreshness({
            syncedAt: '2026-09-06T02:50:22Z',
            latestDay: '2026-08-30',
            until: '2026-09-06',
        });
        expect(f.completeTo).toBe('2026-08-30');
        expect(f.partial).toBe(true);
    });

    // Never let "nothing synced" read as "complete".
    it('claims nothing when nothing has ever synced', () => {
        expect(spendFreshness({ syncedAt: null, latestDay: null, until: '2026-09-06' }))
            .toEqual({ syncedAt: null, completeTo: null, partial: false });
    });

    it('makes no claim when no window was asked for', () => {
        const f = spendFreshness({ syncedAt: '2026-09-06T02:50:22Z', latestDay: '2026-09-06' });
        expect(f.partial).toBe(false);
        expect(f.completeTo).toBe('2026-09-05');
    });

    // BST: 2026-09-06T23:30Z is already the 7th in London, so the 6th is final.
    // A UTC-only reading would call the 6th partial and hide a real day.
    it('uses the London day, not the UTC day', () => {
        const f = spendFreshness({
            syncedAt: '2026-09-06T23:30:00Z',
            latestDay: '2026-09-07',
            until: '2026-09-06',
        });
        expect(f.completeTo).toBe('2026-09-06');
        expect(f.partial).toBe(false);
    });

    // Crossing the 1st exercises previousDay's month rollover.
    it('rolls back across a month boundary', () => {
        const f = spendFreshness({
            syncedAt: '2026-09-01T02:50:00Z',
            latestDay: '2026-09-01',
            until: '2026-09-01',
        });
        expect(f.completeTo).toBe('2026-08-31');
        expect(f.partial).toBe(true);
    });
});
