// Europe/London date helpers.
//
// The client operates in London and the ad platforms (Meta/Google) bucket their
// data by the ad account's London timezone, so KPI date buckets and query
// windows must be derived in London LOCAL time — not UTC. London is UTC+1 in
// summer (BST) and UTC+0 in winter (GMT), so a late-evening UTC instant belongs
// to the NEXT London day (e.g. 2026-06-10T23:30Z is 2026-06-11 in London).
//
// Storage stays UTC ISO 8601 (rule: never store formatted dates). These helpers
// only answer "which London day/month does this instant fall in?" and "what UTC
// instant is London-local midnight of this date?". No timezone library — the
// platform Intl database (Europe/London, DST-aware) is the source of truth.

const TZ = 'Europe/London';

// en-CA renders as YYYY-MM-DD, so this yields the London calendar date directly.
const YMD = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
});

function toDate(d) {
    return d instanceof Date ? d : new Date(d);
}

// London calendar date (YYYY-MM-DD) that the given instant falls in.
export function londonYmd(date = new Date()) {
    return YMD.format(toDate(date));
}

// London date N*24h before the reference instant, as YYYY-MM-DD.
export function londonDaysAgo(n, from = new Date()) {
    return londonYmd(new Date(toDate(from).getTime() - n * 86400_000));
}

// London month key (YYYY-MM) the instant falls in.
export function londonMonthKey(date = new Date()) {
    return londonYmd(date).slice(0, 7);
}

// { year, month, day } in London local time (month is 1-12).
export function londonParts(date = new Date()) {
    const [year, month, day] = londonYmd(date).split('-').map(Number);
    return { year, month, day };
}

// London local offset from UTC, in minutes east of UTC, AT the given instant
// (handles BST/GMT). Computed by rendering the instant as London wall-clock and
// comparing to the UTC interpretation of those same wall-clock fields.
const WALL = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
});
function offsetMinutes(date) {
    const p = Object.fromEntries(
        WALL.formatToParts(date).filter((x) => x.type !== 'literal').map((x) => [x.type, x.value]),
    );
    const hour = p.hour === '24' ? 0 : Number(p.hour); // Intl can emit hour 24 for midnight
    const asUTC = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), hour, Number(p.minute), Number(p.second));
    return Math.round((asUTC - date.getTime()) / 60000);
}

// UTC Date corresponding to London-local midnight of the given YYYY-MM-DD.
// During BST this is the prior day's 23:00 UTC; during GMT it is 00:00 UTC.
export function londonMidnightUTC(ymd) {
    const guess = new Date(`${ymd}T00:00:00Z`);
    let result = new Date(guess.getTime() - offsetMinutes(guess) * 60000);
    // Re-check at the candidate instant in case the guess straddled a DST change.
    const off2 = offsetMinutes(result);
    const corrected = new Date(guess.getTime() - off2 * 60000);
    if (corrected.getTime() !== result.getTime()) result = corrected;
    return result;
}

// UTC ISO 8601 string for London-local midnight of the given YYYY-MM-DD.
export function londonStartOfDayISO(ymd) {
    return londonMidnightUTC(ymd).toISOString();
}

// London-local day of week: 0=Sunday .. 6=Saturday.
const WEEKDAY = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' });
const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
export function londonWeekday(date = new Date()) {
    return WEEKDAY_INDEX[WEEKDAY.format(toDate(date))];
}
