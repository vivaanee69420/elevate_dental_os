// overlayPeriodReach — replaces the (non-additive, wrongly-summed) daily reach
// with Meta's period-deduplicated reach stored on ad_accounts. Reach can't be
// summed across days; frequency = period impressions / period unique reach.
import { describe, it, expect } from 'vitest';
import { overlayPeriodReach } from '../src/lib/marketing-reach.js';

describe('overlayPeriodReach', () => {
    const FROM = '2026-05-11', TO = '2026-06-09';

    it('uses the snapshot reach (not the daily sum) and derives frequency from impressions/reach', () => {
        const snaps = [{ period_reach: 168000, period_frequency: 3.9, period_window_start: FROM, period_window_end: TO }];
        const r = overlayPeriodReach(658907, snaps, FROM, TO);
        expect(r.reach).toBe(168000);
        expect(r.frequency).toBe(3.9);
        expect(r.reach_is_approx).toBe(false);
    });

    it('sums reach across accounts (Meta cannot dedupe across accounts) and recomputes frequency', () => {
        const snaps = [
            { period_reach: 100000, period_frequency: 4.0, period_window_start: FROM, period_window_end: TO },
            { period_reach: 50000, period_frequency: 2.0, period_window_start: FROM, period_window_end: TO },
        ];
        const r = overlayPeriodReach(600000, snaps, FROM, TO);
        expect(r.reach).toBe(150000);
        expect(r.frequency).toBe(4); // 600000 / 150000
        expect(r.reach_is_approx).toBe(false);
    });

    it('flags approximate when a contributing window differs from the requested window', () => {
        const snaps = [{ period_reach: 168000, period_frequency: 3.9, period_window_start: '2026-05-10', period_window_end: TO }];
        const r = overlayPeriodReach(658907, snaps, FROM, TO);
        expect(r.reach).toBe(168000);
        expect(r.reach_is_approx).toBe(true);
    });

    it('returns null reach (not zero) when no snapshot has reach — e.g. Google-only', () => {
        const r = overlayPeriodReach(500, [{ period_reach: null, period_window_start: FROM, period_window_end: TO }], FROM, TO);
        expect(r.reach).toBeNull();
        expect(r.frequency).toBeNull();
        expect(r.reach_is_approx).toBe(false);
    });

    it('returns null reach when there are no snapshots at all', () => {
        const r = overlayPeriodReach(500, [], FROM, TO);
        expect(r.reach).toBeNull();
        expect(r.frequency).toBeNull();
    });
});
