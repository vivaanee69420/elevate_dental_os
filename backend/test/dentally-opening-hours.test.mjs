// Parsing Dentally's /sites opening_hours. Every shape below was observed in
// the live payload on 2026-09-08 — the unpadded "9:00" and the absent Sunday
// are real, not defensive guesses.
import { describe, it, expect } from 'vitest';
import { parseTimeToMinutes, parseOpeningHours } from '../src/lib/dentally-opening-hours.js';

describe('parseTimeToMinutes', () => {
    it('accepts both padded and unpadded hours (both occur live)', () => {
        expect(parseTimeToMinutes('08:30')).toBe(510);
        expect(parseTimeToMinutes('9:00')).toBe(540);
        expect(parseTimeToMinutes('17:30')).toBe(1050);
        expect(parseTimeToMinutes('20:00')).toBe(1200);
        expect(parseTimeToMinutes(' 09:00 ')).toBe(540);
    });

    it('returns null for anything it cannot parse', () => {
        for (const bad of ['', 'closed', '9', '25:00', '09:75', '9:0', null, undefined, 900]) {
            expect(parseTimeToMinutes(bad)).toBeNull();
        }
    });
});

describe('parseOpeningHours', () => {
    it('parses the real Ashford payload; Sunday is absent, so Sunday is closed', () => {
        const { rows, errors } = parseOpeningHours({
            Monday: { open: '09:00', close: '17:00' },
            Tuesday: { open: '09:00', close: '17:00' },
            Wednesday: { open: '09:00', close: '17:00' },
            Thursday: { open: '09:00', close: '17:00' },
            Friday: { open: '09:00', close: '17:00' },
            Saturday: { open: '09:00', close: '17:00' },
        });
        expect(errors).toEqual([]);
        expect(rows).toHaveLength(7);
        for (let d = 1; d <= 6; d++) {
            expect(rows[d - 1]).toEqual({ weekday: d, openMinute: 540, closeMinute: 1020 });
        }
        expect(rows[6]).toEqual({ weekday: 7, openMinute: null, closeMinute: null });
    });

    it('handles the real GM Dental payload: unpadded Saturday, late Thursday', () => {
        const { rows, errors } = parseOpeningHours({
            Monday: { open: '08:30', close: '17:30' },
            Thursday: { open: '08:30', close: '20:00' },
            Saturday: { open: '9:00', close: '17:30' },
        });
        expect(errors).toEqual([]);
        expect(rows[0]).toEqual({ weekday: 1, openMinute: 510, closeMinute: 1050 });
        expect(rows[3]).toEqual({ weekday: 4, openMinute: 510, closeMinute: 1200 });
        expect(rows[5]).toEqual({ weekday: 6, openMinute: 540, closeMinute: 1050 });
        // Tuesday/Wednesday/Friday absent -> closed, and that is NOT an error.
        expect(rows[1]).toEqual({ weekday: 2, openMinute: null, closeMinute: null });
    });

    it('is case-insensitive about weekday keys', () => {
        const { rows } = parseOpeningHours({ monday: { open: '09:00', close: '17:00' } });
        expect(rows[0]).toEqual({ weekday: 1, openMinute: 540, closeMinute: 1020 });
    });

    it('records an unparseable time as an ERROR, never as a silent closure', () => {
        // The distinction matters: a closed day is a fact, an unparseable day is
        // a bug we must be told about. Both render as closed, only one reports.
        const { rows, errors } = parseOpeningHours({
            Monday: { open: 'half nine', close: '17:00' },
        });
        expect(rows[0]).toEqual({ weekday: 1, openMinute: null, closeMinute: null });
        expect(errors).toEqual([
            { weekday: 1, day: 'Monday', reason: 'unparseable open/close time' },
        ]);
    });

    it('rejects a close at or before the open', () => {
        const { rows, errors } = parseOpeningHours({
            Monday: { open: '17:00', close: '09:00' },
        });
        expect(rows[0]).toEqual({ weekday: 1, openMinute: null, closeMinute: null });
        expect(errors[0].reason).toBe('close is not after open');
    });

    it('a missing or non-object payload gives seven closed days, no errors', () => {
        for (const empty of [null, undefined, {}, 'nope', 42]) {
            const { rows, errors } = parseOpeningHours(empty);
            expect(rows).toHaveLength(7);
            expect(rows.every((r) => r.openMinute === null)).toBe(true);
            expect(errors).toEqual([]);
        }
    });
});
