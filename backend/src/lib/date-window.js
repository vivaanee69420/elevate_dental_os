// ============================================================================
// Day-window normalisation — the single place a [from,to] pair of calendar days
// becomes a half-open-safe instant range.
//
// WHY THIS EXISTS. Every screen that offers MTD/QTD/YTD hands the backend two
// calendar days (`YYYY-MM-DD`). A calendar day is not an instant, so each
// endpoint has to decide what "up to and including 3 September" means. When
// they decide separately they drift, and the drift is invisible: the page still
// renders, the numbers are still plausible, they just describe different
// windows.
//
// That is not hypothetical. `dashboardSummary` expanded `to` to 23:59:59 while
// the lead funnel passed the bare `YYYY-MM-DD` straight to a timestamptz
// parameter, where it parses as MIDNIGHT AT THE START of that day. The funnel
// therefore dropped its entire final day — 44 leads out of 1,429 for August
// (3%), and on the first day of an MTD window it would report zero leads while
// the KPI cards beside it reported a full day of revenue.
//
// So the rule is: no endpoint computes its own day bounds. It calls this.
//
// TIMEZONE — Europe/London, matching the rest of the product.
//
// This used to build bounds in the SERVER's zone (UTC in every deployed
// environment) and carried a note calling the residual skew "a known, bounded
// limitation". It was neither bounded nor harmless. The frontend period pickers
// resolve their windows in Europe/London (`londonISO` in scope-context), so a
// UTC-built bound here described a different day from the one the user picked,
// and the two disagreed by an hour for the ~7 months a year Britain is on BST.
// A UK dental group's day is a London day: Dentally reports it that way, the
// practices bank that way, and the owner reads it that way.
//
// Europe/London is the whole UK zone, not just its summer half — BST (UTC+1)
// from late March to late October, GMT (UTC+0) the rest of the year. Pinning a
// fixed +1 would be wrong every winter, so the offset is resolved from Intl at
// the target instant rather than hardcoded.
//
// The SQL side of this same convention lives in migration
// `20260101000161_london_window_convention.sql` (`window_first_day` /
// `window_last_day`). Both halves must agree; change them together.
// ============================================================================

const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/;

// Europe/London offset (minutes ahead of UTC) at a given UTC instant. Uses Intl
// so the BST/GMT transition dates are exact and need no table. Mirrors
// `londonOffsetMinutes` in frontend/features/_shared/scope-context.tsx.
function londonOffsetMinutes(utcMs) {
    const dtf = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London', hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const p = {};
    for (const part of dtf.formatToParts(new Date(utcMs))) p[part.type] = part.value;
    let hour = +p.hour;
    if (hour === 24) hour = 0; // en-GB renders midnight as 24
    const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, hour, +p.minute, +p.second);
    return Math.round((asUTC - utcMs) / 60000);
}

// UTC instant of a London WALL-CLOCK time. Two passes resolve the DST-transition
// edge, where the offset on either side of the boundary differs.
function londonInstant(y, m, d, hh = 0, mi = 0, ss = 0, ms = 0) {
    const wall = Date.UTC(y, m, d, hh, mi, ss, ms);
    let off = londonOffsetMinutes(wall);
    off = londonOffsetMinutes(wall - off * 60000);
    return new Date(wall - off * 60000);
}

// Expand a calendar day to the FIRST instant of that LONDON day. Anything that
// is already a full timestamp is passed through untouched.
export function startOfDayISO(value) {
    if (!value) return null;
    if (value instanceof Date) return value.toISOString();
    if (!DAY_ONLY.test(value)) return value;
    const [y, m, d] = value.split('-').map(Number);
    return londonInstant(y, m - 1, d).toISOString();
}

// Expand a calendar day to the LAST instant of that LONDON day, so a filter
// written as `<= until` includes everything that happened on it. This is the
// half of the pair that gets forgotten, and forgetting it loses a whole day.
export function endOfDayISO(value) {
    if (!value) return null;
    if (value instanceof Date) return value.toISOString();
    if (!DAY_ONLY.test(value)) return value;
    const [y, m, d] = value.split('-').map(Number);
    return londonInstant(y, m - 1, d, 23, 59, 59, 999).toISOString();
}

// The EXCLUSIVE upper bound for a calendar day: the first instant of the NEXT
// London day. This is the shape the period pickers produce and the shape the
// SQL helpers expect (`window_last_day` steps back from it) — prefer it over
// `endOfDayISO` for anything that reaches a date-column aggregate, because a
// 23:59:59.999 bound resolves to the FOLLOWING London day through BST.
// Date.UTC normalises the day overflow (31 Aug + 1 -> 1 Sep).
export function exclusiveEndISO(value) {
    if (!value) return null;
    if (value instanceof Date) return value.toISOString();
    if (!DAY_ONLY.test(value)) return value;
    const [y, m, d] = value.split('-').map(Number);
    return londonInstant(y, m - 1, d + 1).toISOString();
}

// The pair, for the common case. `ranged` is true only when BOTH bounds are
// present — a lone bound is ambiguous and every caller treats it as "no window".
export function dayWindowISO(from, to) {
    const ranged = !!(from && to);
    return {
        ranged,
        sinceISO: ranged ? startOfDayISO(from) : null,
        untilISO: ranged ? endOfDayISO(to) : null,
    };
}
