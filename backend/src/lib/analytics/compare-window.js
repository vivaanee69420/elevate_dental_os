// ============================================================================
// The two windows a period-over-period comparison is measured across.
//
// WHY THIS EXISTS. The Business Hub cards used to name their comparison with
// `prevWindowLabel`, which guessed what kind of window it had been handed by
// testing `d.getUTCDate() === 1` for a calendar month. The period pickers build
// their bounds in Europe/London (`londonISO` in scope-context), so September
// 2026 arrives as 2026-08-31T23:00:00Z and that test reads 31. The month branch
// never fired through BST and the chip degraded to the bare string "prev
// period" from late March to late October each year — the same UTC-reading-of-a-
// London-instant bug that migration 20260101000163 fixed on the SQL side.
//
// The fix is to stop guessing. This returns the previous window's ACTUAL bounds
// and formats the label from them, so a label cannot disagree with the window
// it names.
//
// TWO RULES, both of which the old code got wrong:
//
//   1. A STILL-RUNNING PERIOD IS CLAMPED. "Sep 2026" spans 1 Sep – 1 Oct, but
//      on the 6th only six days have data. The old code compared it against a
//      full same-length window back (2 Aug – 1 Sep): six days of takings
//      against thirty, rendered as ▼81.2% as though the group had collapsed.
//      A running period runs to the end of TODAY and compares against the same
//      elapsed span of its predecessor — 1–6 Sep vs 1–6 Aug.
//
//   2. SPANS ARE COUNTED IN LONDON DAYS, NOT MILLISECONDS. October 2026 begins
//      in BST and ends in GMT, so its bounds carry different offsets. Adding a
//      millisecond span to the predecessor's start lands an hour short across a
//      clock change and silently drops the window's last day. Calendar-day
//      arithmetic has no such edge.
//
// Clamping is to the end of the current London DAY, not to the current instant,
// so the answer is stable for the whole day: the Business Hub payload is cached
// and its label must not disagree with the figures beneath it.
// ============================================================================
import { londonYmd, londonStartOfDayISO } from '../tz.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const partsOf = (ymd) => { const [y, m, d] = ymd.split('-').map(Number); return { y, m, d }; };
const ymdOf = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);

// Calendar-date arithmetic. Date.UTC normalises day/month overflow, so these
// never see a timezone and cannot drift across a clock change.
const addDays = (ymd, n) => { const p = partsOf(ymd); return ymdOf(p.y, p.m, p.d + n); };
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

// The inclusive last London day of a half-open [since, until) window. Derived
// as `until - 1ms`, which is right whichever bound convention the caller used.
const lastDayOf = (untilISO) => londonYmd(new Date(new Date(untilISO).getTime() - 1));

// Exactly one London calendar month? Returns its {y, m} or null.
function calendarMonth(firstYmd, lastYmd) {
    const a = partsOf(firstYmd), b = partsOf(lastYmd);
    if (a.d !== 1 || a.y !== b.y || a.m !== b.m) return null;
    return addDays(lastYmd, 1) === ymdOf(a.y, a.m + 1, 1) ? { y: a.y, m: a.m } : null;
}

// Exactly one London calendar year? Returns its year or null.
function calendarYear(firstYmd, lastYmd) {
    const a = partsOf(firstYmd), b = partsOf(lastYmd);
    return (a.d === 1 && a.m === 1 && b.d === 31 && b.m === 12 && a.y === b.y) ? a.y : null;
}

// Human label for an inclusive London day range. A whole month is named as the
// month, a whole year as the year; anything else states its days, carrying the
// month (and year) only as far as it changes.
export function windowLabel(firstYmd, lastYmd) {
    const year = calendarYear(firstYmd, lastYmd);
    if (year) return String(year);
    const month = calendarMonth(firstYmd, lastYmd);
    if (month) return `${MONTHS[month.m - 1]} ${month.y}`;

    const a = partsOf(firstYmd), b = partsOf(lastYmd);
    if (firstYmd === lastYmd) return `${a.d} ${MONTHS[a.m - 1]} ${a.y}`;
    if (a.y !== b.y) return `${a.d} ${MONTHS[a.m - 1]} ${a.y} – ${b.d} ${MONTHS[b.m - 1]} ${b.y}`;
    if (a.m !== b.m) return `${a.d} ${MONTHS[a.m - 1]} – ${b.d} ${MONTHS[b.m - 1]} ${b.y}`;
    return `${a.d}–${b.d} ${MONTHS[a.m - 1]} ${a.y}`;
}

/**
 * Resolve a selected window into the pair of windows a comparison is measured
 * across.
 *
 * @param {object}      o
 * @param {string}      o.since  ISO instant, the window's inclusive start.
 * @param {string|null} o.until  ISO instant, exclusive end. Null in trailing-days mode.
 * @param {Date}        [o.now]  Reference instant (injected by tests).
 * @returns {{
 *   current:  { since: string, until: string, label: string },
 *   previous: { since: string, until: string, label: string },
 *   complete: boolean,
 * }} `complete` is false only while the selected period is still running, in
 *    which case both windows cover the same elapsed span rather than the full
 *    selected one.
 */
export function comparisonWindows({ since, until = null, now = new Date() }) {
    const sinceYmd = londonYmd(new Date(since));
    // End of today, London. A window running past this is still in progress.
    const todayYmd = londonYmd(now);
    const tomorrowISO = londonStartOfDayISO(addDays(todayYmd, 1));

    const running = until != null && new Date(until).getTime() > new Date(tomorrowISO).getTime();
    const currentUntil = until == null || running ? tomorrowISO : new Date(until).toISOString();
    const currentLastYmd = lastDayOf(currentUntil);
    const elapsedDays = daysBetween(sinceYmd, currentLastYmd) + 1;

    // The selected window's own full length — what a range with no calendar
    // predecessor is shifted back by. For a trailing window, which has no end
    // to reach, that is the elapsed span itself.
    const selectedLastYmd = until == null ? currentLastYmd : lastDayOf(new Date(until).toISOString());
    const selectedDays = daysBetween(sinceYmd, selectedLastYmd) + 1;

    // Where the previous window starts. A calendar month or year steps back to
    // its own predecessor so August is compared with the whole of July, not
    // with a 31-day shift off August's first day. Everything else — a custom
    // range, a trailing window, a single day — has no calendar predecessor, so
    // it shifts back by its own length.
    const sinceParts = partsOf(sinceYmd);
    const month = calendarMonth(sinceYmd, selectedLastYmd);
    const year = calendarYear(sinceYmd, selectedLastYmd);
    const prevSinceYmd = year ? ymdOf(year - 1, 1, 1)
        : month ? ymdOf(sinceParts.y, sinceParts.m - 1, 1)
            : addDays(sinceYmd, -selectedDays);

    // A finished period is compared against the whole of its predecessor; a
    // running one against the same number of days from that predecessor's start.
    const prevLastYmd = running ? addDays(prevSinceYmd, elapsedDays - 1) : addDays(sinceYmd, -1);

    return {
        current: {
            since: new Date(since).toISOString(),
            until: currentUntil,
            label: windowLabel(sinceYmd, currentLastYmd),
            days: elapsedDays,
        },
        previous: {
            since: londonStartOfDayISO(prevSinceYmd),
            until: londonStartOfDayISO(addDays(prevLastYmd, 1)),
            label: windowLabel(prevSinceYmd, prevLastYmd),
            // Counted in London days for the same reason the bounds are: a
            // millisecond span across a clock change is an hour short, and
            // anything pro-rated over it inherits the error invisibly.
            days: daysBetween(prevSinceYmd, prevLastYmd) + 1,
        },
        complete: !running,
    };
}
