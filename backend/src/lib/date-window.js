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
// TIMEZONE. Bounds are built in the server's local zone (UTC in every deployed
// environment) to stay byte-identical to the behaviour dashboardSummary already
// had — changing the zone here would silently move every existing figure. The
// residual sub-day skew for a London user in BST is a known, bounded limitation
// shared by every screen, not something this helper introduces. If day bounds
// ever move to Europe/London, this is the one function to change.
// ============================================================================

const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/;

// Expand a calendar day to the FIRST instant of that day. Anything that is
// already a full timestamp is passed through untouched.
export function startOfDayISO(value) {
    if (!value) return null;
    if (value instanceof Date) return value.toISOString();
    if (!DAY_ONLY.test(value)) return value;
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
}

// Expand a calendar day to the LAST instant of that day, so a filter written as
// `<= until` includes everything that happened on it. This is the half of the
// pair that gets forgotten, and forgetting it loses a whole day of data.
export function endOfDayISO(value) {
    if (!value) return null;
    if (value instanceof Date) return value.toISOString();
    if (!DAY_ONLY.test(value)) return value;
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d, 23, 59, 59, 999).toISOString();
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
