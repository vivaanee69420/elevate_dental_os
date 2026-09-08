// Slot/opening-hours overlap. The whole point of the open-ended first and last
// slots is the invariant asserted in every case below: the slot minutes for a
// day must sum to exactly (close - open), for ANY opening hours. A fixed
// 08:00-20:00 envelope silently loses capacity outside it.
import { describe, it, expect } from 'vitest';
import {
    SLOTS, slotAvailableMinutes, daySlotMinutes, slotIndexOf,
} from '../src/lib/chair-slots.js';

const sumEqualsSpan = (open, close) => {
    const mins = daySlotMinutes(open, close);
    expect(mins.reduce((a, b) => a + b, 0)).toBe(close - open);
    return mins;
};

describe('chair-slots', () => {
    it('exposes the four slots in order', () => {
        expect(SLOTS).toEqual(['morning', 'midday', 'afternoon', 'evening']);
        expect(slotIndexOf('afternoon')).toBe(2);
        expect(slotIndexOf('nope')).toBe(-1);
    });

    it('Ashford 09:00-17:00 -> evening is closed, day sums to 480', () => {
        // 540..1020. The real Ashford hours; its evening slot having zero
        // available is why Ashford has 3 open slots a day, not 4.
        expect(sumEqualsSpan(540, 1020)).toEqual([120, 180, 180, 0]);
    });

    it('Barnet 08:30-17:30 -> a 30-minute evening, day sums to 540', () => {
        expect(sumEqualsSpan(510, 1050)).toEqual([150, 180, 180, 30]);
    });

    it('Rochester Thursday 08:30-20:00 -> full evening, sums to 690', () => {
        expect(sumEqualsSpan(510, 1200)).toEqual([150, 180, 180, 180]);
    });

    it('hours OUTSIDE the 08:00-20:00 envelope lose nothing', () => {
        // 07:00-21:00. Under a fixed envelope this would report 720 of 840
        // minutes and silently drop two hours of capacity.
        expect(sumEqualsSpan(420, 1260)).toEqual([240, 180, 180, 240]);
    });

    it('a one-hour morning-only day puts everything in the first slot', () => {
        expect(sumEqualsSpan(540, 600)).toEqual([60, 0, 0, 0]);
    });

    it('an evening-only day puts everything in the last slot', () => {
        expect(sumEqualsSpan(1080, 1200)).toEqual([0, 0, 0, 120]);
    });

    it('closed day (null) -> all zero, never negative', () => {
        expect(daySlotMinutes(null, null)).toEqual([0, 0, 0, 0]);
        expect(daySlotMinutes(540, null)).toEqual([0, 0, 0, 0]);
        expect(daySlotMinutes(null, 1020)).toEqual([0, 0, 0, 0]);
    });

    it('close at or before open -> all zero, not a negative span', () => {
        expect(daySlotMinutes(1020, 540)).toEqual([0, 0, 0, 0]);
        expect(daySlotMinutes(600, 600)).toEqual([0, 0, 0, 0]);
    });

    it('slotAvailableMinutes agrees with daySlotMinutes per index', () => {
        for (let i = 0; i < SLOTS.length; i++) {
            expect(slotAvailableMinutes(i, 510, 1050)).toBe(daySlotMinutes(510, 1050)[i]);
        }
    });
});
