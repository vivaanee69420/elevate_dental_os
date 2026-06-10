// London timezone helpers. The client operates in Europe/London and the ad
// platforms (Meta/Google) bucket by the account's London timezone, so KPI date
// buckets and query windows must be derived in London local time — NOT UTC.
// Storage stays UTC ISO 8601; these helpers only decide which London day/month
// an instant falls in, and the UTC instant of a London-local midnight.
import { describe, it, expect } from 'vitest';
import { londonYmd, londonDaysAgo, londonMonthKey, londonParts, londonMidnightUTC, londonStartOfDayISO } from '../src/lib/tz.js';

describe('londonYmd', () => {
    it('rolls to the next day for a late-evening UTC instant during BST (UTC+1)', () => {
        // 2026-06-10 23:30 UTC = 2026-06-11 00:30 London (BST) -> London day is the 11th.
        expect(londonYmd(new Date('2026-06-10T23:30:00Z'))).toBe('2026-06-11');
    });
    it('matches UTC during GMT (winter, UTC+0)', () => {
        expect(londonYmd(new Date('2026-01-15T23:30:00Z'))).toBe('2026-01-15');
        expect(londonYmd(new Date('2026-01-15T00:30:00Z'))).toBe('2026-01-15');
    });
    it('accepts an ISO string', () => {
        expect(londonYmd('2026-06-10T23:30:00Z')).toBe('2026-06-11');
    });
});

describe('londonDaysAgo', () => {
    it('counts back N London days from a reference instant', () => {
        // From 2026-06-10 12:00 UTC, 30 days ago = 2026-05-11 (London).
        expect(londonDaysAgo(30, new Date('2026-06-10T12:00:00Z'))).toBe('2026-05-11');
    });
});

describe('londonMonthKey', () => {
    it('uses the London month, which can differ from the UTC month at a boundary', () => {
        // 2026-06-30 23:30 UTC = 2026-07-01 00:30 London -> month key 2026-07.
        expect(londonMonthKey(new Date('2026-06-30T23:30:00Z'))).toBe('2026-07');
        expect(londonMonthKey(new Date('2026-06-10T12:00:00Z'))).toBe('2026-06');
    });
});

describe('londonParts', () => {
    it('returns London year/month/day numbers', () => {
        expect(londonParts(new Date('2026-06-10T23:30:00Z'))).toEqual({ year: 2026, month: 6, day: 11 });
    });
});

describe('londonMidnightUTC / londonStartOfDayISO', () => {
    it('maps a London-local midnight to the correct UTC instant during BST', () => {
        // London midnight 2026-06-11 (BST, UTC+1) = 2026-06-10 23:00:00 UTC.
        expect(londonMidnightUTC('2026-06-11').toISOString()).toBe('2026-06-10T23:00:00.000Z');
        expect(londonStartOfDayISO('2026-06-11')).toBe('2026-06-10T23:00:00.000Z');
    });
    it('maps a London-local midnight to UTC during GMT (winter)', () => {
        expect(londonMidnightUTC('2026-01-15').toISOString()).toBe('2026-01-15T00:00:00.000Z');
    });
});
