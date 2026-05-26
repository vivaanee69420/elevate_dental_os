// Chair utilisation — pure grid aggregation (no I/O).
import { describe, it, expect } from 'vitest';
import { aggregateGrid, SLOTS } from '../src/lib/chair-utilisation.js';

const rec = (o) => ({ weekday: 1, slot: 'morning', booked_minutes: 0, available_minutes: 0, ...o });

describe('aggregateGrid', () => {
    it('exposes 7 weekdays x 4 slots, null where no capacity', () => {
        const { days, slots, grid } = aggregateGrid([]);
        expect(slots).toEqual(SLOTS);
        expect(days).toEqual([1, 2, 3, 4, 5, 6, 7]);
        expect(grid).toHaveLength(SLOTS.length);
        expect(grid[0]).toHaveLength(7);
        expect(grid[0][0].pct).toBeNull();
    });

    it('sums booked/available across chairs in the same cell and caps at 100', () => {
        const { grid } = aggregateGrid([
            rec({ chair_name: 'S1', weekday: 2, slot: 'midday', booked_minutes: 180, available_minutes: 240 }),
            rec({ chair_name: 'S2', weekday: 2, slot: 'midday', booked_minutes: 240, available_minutes: 240 }),
        ]);
        const cell = grid[SLOTS.indexOf('midday')][1];
        expect(cell.bookedMin).toBe(420);
        expect(cell.availableMin).toBe(480);
        expect(cell.pct).toBe(88);
    });

    it('caps utilisation at 100 when booked exceeds available', () => {
        const { grid } = aggregateGrid([
            rec({ weekday: 1, slot: 'morning', booked_minutes: 300, available_minutes: 180 }),
        ]);
        expect(grid[0][0].pct).toBe(100);
    });

    it('kpis: avg over non-null cells, peak/lowest, idle chair-hours', () => {
        const { kpis } = aggregateGrid([
            rec({ weekday: 1, slot: 'morning', booked_minutes: 90, available_minutes: 180 }),
            rec({ weekday: 2, slot: 'midday', booked_minutes: 180, available_minutes: 200 }),
        ]);
        expect(kpis.avgUtilPct).toBe(70);
        expect(kpis.peakSlot).toEqual({ weekday: 2, slot: 'midday', pct: 90 });
        expect(kpis.lowestSlot).toEqual({ weekday: 1, slot: 'morning', pct: 50 });
        expect(kpis.idleChairHours).toBe(1.8);
    });

    it('all-empty kpis are null/0, not NaN', () => {
        const { kpis } = aggregateGrid([]);
        expect(kpis.avgUtilPct).toBeNull();
        expect(kpis.peakSlot).toBeNull();
        expect(kpis.lowestSlot).toBeNull();
        expect(kpis.idleChairHours).toBe(0);
    });
});
