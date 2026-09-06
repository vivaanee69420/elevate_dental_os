// ============================================================================
// Period-over-period comparison windows for the Business Hub cards.
//
// WHY THIS EXISTS. The chip under Takings read "▼ 81.2% vs prev period" — an
// unnamed comparison — for seven months of every year. The old
// `prevWindowLabel` recognised a calendar month by testing
// `d.getUTCDate() === 1`, but the period pickers build their bounds in
// Europe/London (`londonISO` in scope-context), so September 2026 arrives as
// 2026-08-31T23:00:00Z and `getUTCDate()` is 31. The month branch never fired
// through BST, and the label silently degraded to the string "prev period"
// from late March to late October. Same family as the SQL-side window bug
// fixed in migration 20260101000163.
//
// The fix is not a better guess. It is to stop pattern-matching the window and
// return the previous period's ACTUAL bounds, then format the label from those
// — a label derived from the dates it names cannot disagree with them.
//
// Second thing these pin: a period that has not finished yet. "Sep 2026" spans
// 1 Sep – 1 Oct, but on the 6th only six days have data. Comparing that to a
// full same-length window back (2 Aug – 1 Sep) measured six days of takings
// against thirty and rendered ▼81.2% as though the group had collapsed. A
// running period compares against the SAME ELAPSED SPAN of its predecessor.
// ============================================================================
import { describe, it, expect } from 'vitest';

const { comparisonWindows } = await import('../src/lib/analytics/compare-window.js');

// The frontend's londonISO: UTC instant of London wall-clock midnight.
// Duplicated here rather than imported so the test pins the real-world input
// shape (what the browser actually sends) instead of trusting a shared helper.
const BST_SEP_1 = '2026-08-31T23:00:00.000Z'; // London 1 Sep 2026 00:00 (BST)
const BST_OCT_1 = '2026-09-30T23:00:00.000Z'; // London 1 Oct 2026 00:00 (BST)
const BST_AUG_1 = '2026-07-31T23:00:00.000Z'; // London 1 Aug 2026 00:00 (BST)
const BST_JUL_1 = '2026-06-30T23:00:00.000Z'; // London 1 Jul 2026 00:00 (BST)
const GMT_JAN_1_2026 = '2026-01-01T00:00:00.000Z'; // London 1 Jan 2026 00:00 (GMT)
const GMT_FEB_1_2026 = '2026-02-01T00:00:00.000Z';
const GMT_DEC_1_2025 = '2025-12-01T00:00:00.000Z';
const GMT_JAN_1_2025 = '2025-01-01T00:00:00.000Z';

// Mid-afternoon on 6 September 2026, London (BST) — the moment the screenshot
// that started this was taken.
const SEP_6 = new Date('2026-09-06T13:20:00.000Z');

describe('comparisonWindows — a running calendar month', () => {
    it('compares the elapsed days against the same days of the previous month', () => {
        const w = comparisonWindows({ since: BST_SEP_1, until: BST_OCT_1, now: SEP_6 });

        // Current stops at the end of TODAY (London), not at 1 Oct.
        expect(w.current.since).toBe(BST_SEP_1);
        expect(w.current.until).toBe('2026-09-06T23:00:00.000Z'); // London 7 Sep 00:00
        // Previous starts at the previous month's own first day and runs the
        // same number of days — 1–6 Aug, not the 2 Aug – 1 Sep the fixed
        // same-length shift produced.
        expect(w.previous.since).toBe(BST_AUG_1);
        expect(w.previous.until).toBe('2026-08-06T23:00:00.000Z'); // London 7 Aug 00:00
    });

    it('names both windows by their London days and says the period is unfinished', () => {
        const w = comparisonWindows({ since: BST_SEP_1, until: BST_OCT_1, now: SEP_6 });

        expect(w.current.label).toBe('1–6 Sep 2026');
        expect(w.previous.label).toBe('1–6 Aug 2026');
        expect(w.complete).toBe(false);
    });

    it('never returns the unnamed "prev period" string that this replaces', () => {
        const w = comparisonWindows({ since: BST_SEP_1, until: BST_OCT_1, now: SEP_6 });
        expect(w.previous.label).not.toBe('prev period');
    });
});

describe('comparisonWindows — a finished calendar month', () => {
    it('compares August against the whole of July, not a 31-day shift', () => {
        const w = comparisonWindows({ since: BST_AUG_1, until: BST_SEP_1, now: SEP_6 });

        expect(w.complete).toBe(true);
        expect(w.current.label).toBe('Aug 2026');
        expect(w.previous.since).toBe(BST_JUL_1);
        expect(w.previous.until).toBe(BST_AUG_1);
        expect(w.previous.label).toBe('Jul 2026');
    });

    it('recognises a GMT month too, so the label works in both halves of the year', () => {
        const w = comparisonWindows({
            since: GMT_JAN_1_2026, until: GMT_FEB_1_2026, now: new Date('2026-03-02T09:00:00.000Z'),
        });

        expect(w.current.label).toBe('Jan 2026');
        expect(w.previous.since).toBe(GMT_DEC_1_2025);
        expect(w.previous.until).toBe(GMT_JAN_1_2026);
        expect(w.previous.label).toBe('Dec 2025');
    });

    it('crosses the BST boundary without losing a day', () => {
        // October 2026 starts in BST and ends in GMT (the clocks go back on the
        // 25th), so its two bounds carry DIFFERENT offsets: 1 Oct London
        // midnight is 23:00Z the day before, 1 Nov London midnight is 00:00Z.
        // Measuring the span in milliseconds would land an hour short and label
        // the month "1–30 Oct"; the span is counted in London days instead.
        const w = comparisonWindows({
            since: BST_OCT_1, until: '2026-11-01T00:00:00.000Z',
            now: new Date('2026-12-01T09:00:00.000Z'),
        });
        expect(w.current.label).toBe('Oct 2026');
        expect(w.previous.since).toBe(BST_SEP_1);
        expect(w.previous.until).toBe(BST_OCT_1);
        expect(w.previous.label).toBe('Sep 2026');
    });
});

describe('comparisonWindows — a calendar year', () => {
    it('compares a finished year against the previous year', () => {
        const w = comparisonWindows({
            since: GMT_JAN_1_2025, until: GMT_JAN_1_2026, now: SEP_6,
        });

        expect(w.complete).toBe(true);
        expect(w.current.label).toBe('2025');
        expect(w.previous.since).toBe('2024-01-01T00:00:00.000Z');
        expect(w.previous.until).toBe(GMT_JAN_1_2025);
        expect(w.previous.label).toBe('2024');
    });

    it('compares a running year against the same elapsed days last year', () => {
        const w = comparisonWindows({
            since: GMT_JAN_1_2026, until: '2027-01-01T00:00:00.000Z', now: SEP_6,
        });

        expect(w.complete).toBe(false);
        expect(w.current.label).toBe('1 Jan – 6 Sep 2026');
        expect(w.previous.since).toBe(GMT_JAN_1_2025);
        expect(w.previous.label).toBe('1 Jan – 6 Sep 2025');
    });
});

describe('comparisonWindows — ranges with no calendar predecessor', () => {
    it('shifts a custom range back by its own length', () => {
        // London 10–19 Aug 2026 inclusive (10 days).
        const w = comparisonWindows({
            since: '2026-08-09T23:00:00.000Z', until: '2026-08-19T23:00:00.000Z', now: SEP_6,
        });

        expect(w.complete).toBe(true);
        expect(w.current.label).toBe('10–19 Aug 2026');
        expect(w.previous.since).toBe('2026-07-30T23:00:00.000Z'); // London 31 Jul
        expect(w.previous.until).toBe('2026-08-09T23:00:00.000Z');
        expect(w.previous.label).toBe('31 Jul – 9 Aug 2026');
    });

    it('ends a trailing-days comparison where the window starts, at equal length', () => {
        // `?days=90` with no explicit until — reachable by a direct API call.
        // The whole window has already elapsed (it runs up to now), so there is
        // nothing to clamp: the previous window is simply the span immediately
        // before it, and the two must be the same length or the percentage is
        // measured against a different amount of time.
        const since = '2026-08-07T23:00:00.000Z'; // London 8 Aug
        const w = comparisonWindows({ since, until: null, now: SEP_6 });

        expect(w.previous.until).toBe(since);
        const span = (a) => new Date(a.until).getTime() - new Date(a.since).getTime();
        expect(span(w.previous)).toBe(span(w.current));
    });

    it('compares a single day against the day before it', () => {
        const w = comparisonWindows({
            since: '2026-09-04T23:00:00.000Z', until: '2026-09-05T23:00:00.000Z', now: SEP_6,
        });

        expect(w.current.label).toBe('5 Sep 2026');
        expect(w.previous.since).toBe('2026-09-03T23:00:00.000Z');
        expect(w.previous.label).toBe('4 Sep 2026');
    });

    it('labels a range that crosses a year boundary with both years', () => {
        const w = comparisonWindows({
            since: '2025-12-30T00:00:00.000Z', until: '2026-01-02T00:00:00.000Z',
            now: new Date('2026-03-01T09:00:00.000Z'),
        });

        expect(w.current.label).toBe('30 Dec 2025 – 1 Jan 2026');
    });
});

describe('comparisonWindows — the day count each window covers', () => {
    it('counts London days, so a window crossing a clock change is not an hour short', () => {
        // 1 Jan – 6 Sep 2026 inclusive is 249 days. Measured in milliseconds it
        // is 248.958, because the clocks went forward in March — and anything
        // pro-rated over that span (the annual revenue target is) inherits the
        // error without ever looking wrong.
        const w = comparisonWindows({
            since: '2026-01-01T00:00:00.000Z', until: '2027-01-01T00:00:00.000Z', now: SEP_6,
        });

        expect(w.current.days).toBe(249);
        expect(w.previous.days).toBe(249);
    });

    it('counts a whole calendar month as its own length', () => {
        const w = comparisonWindows({ since: BST_AUG_1, until: BST_SEP_1, now: SEP_6 });
        expect(w.current.days).toBe(31);
        expect(w.previous.days).toBe(31); // July
    });
});

describe('comparisonWindows — the clamp itself', () => {
    it('includes today in full rather than cutting the window at the current hour', () => {
        // Two calls hours apart on the same London day must return the same
        // window, or the 60s-cached Business Hub payload would churn all day and
        // the "1–6 Sep" label would disagree with the data behind it.
        const morning = comparisonWindows({ since: BST_SEP_1, until: BST_OCT_1, now: new Date('2026-09-06T07:00:00.000Z') });
        const evening = comparisonWindows({ since: BST_SEP_1, until: BST_OCT_1, now: new Date('2026-09-06T20:00:00.000Z') });

        expect(evening).toEqual(morning);
    });

    it('does not clamp a window that has already finished', () => {
        const w = comparisonWindows({ since: BST_AUG_1, until: BST_SEP_1, now: SEP_6 });
        expect(w.current.until).toBe(BST_SEP_1);
    });
});
