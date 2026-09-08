// ============================================================================
// Dentally /sites `opening_hours` -> per-weekday minute rows.
//
// Shape observed live on 2026-09-08 across all four connected sites:
//   { "Monday": {"open":"08:30","close":"17:30"}, ..., "Saturday": {...} }
//
// Two things the live payload does that a guessed parser would get wrong:
//   1. SUNDAY IS ABSENT from every site. An absent weekday means closed, and
//      that is a fact rather than an error — a six-day practice must not be
//      penalised for not opening on Sunday.
//   2. TIMES ARE NOT CONSISTENTLY ZERO-PADDED: "9:00" appears alongside
//      "08:30" in the same account.
//
// An unparseable time is recorded as an ERROR and rendered closed. Silently
// treating it as closed would turn an upstream change into invisible lost
// capacity. Pure module — no I/O.
// ============================================================================

// ISO weekday numbering: Monday = 1 .. Sunday = 7.
const WEEKDAY_NAMES = [
    'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
];

/** "08:30" | "9:00" -> minutes from local midnight. Null for anything else. */
export function parseTimeToMinutes(raw) {
    if (typeof raw !== 'string') return null;
    const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(raw);
    if (!m) return null;
    const hours = Number(m[1]);
    const minutes = Number(m[2]);
    if (hours > 23 || minutes > 59) return null;
    return hours * 60 + minutes;
}

/**
 * Parse a site's opening_hours object.
 * Always returns SEVEN rows in weekday order, so a caller can upsert the whole
 * week without reasoning about which days happened to be present.
 */
export function parseOpeningHours(payload) {
    const rows = [];
    const errors = [];
    const source = payload && typeof payload === 'object' ? payload : {};

    // Case-insensitive lookup: the live payload is Title-Case, but nothing in
    // the API contract promises that, and a case change upstream would
    // otherwise silently close every practice in the group.
    const byLowerKey = new Map(
        Object.entries(source).map(([k, v]) => [String(k).toLowerCase(), v]),
    );

    for (let weekday = 1; weekday <= 7; weekday++) {
        const day = WEEKDAY_NAMES[weekday - 1];
        const entry = byLowerKey.get(day.toLowerCase());
        const closed = { weekday, openMinute: null, closeMinute: null };

        // Absent day = closed. Not an error.
        if (entry == null || typeof entry !== 'object') {
            rows.push(closed);
            continue;
        }

        const openMinute = parseTimeToMinutes(entry.open);
        const closeMinute = parseTimeToMinutes(entry.close);
        if (openMinute == null || closeMinute == null) {
            errors.push({ weekday, day, reason: 'unparseable open/close time' });
            rows.push(closed);
            continue;
        }
        if (closeMinute <= openMinute) {
            errors.push({ weekday, day, reason: 'close is not after open' });
            rows.push(closed);
            continue;
        }
        rows.push({ weekday, openMinute, closeMinute });
    }

    return { rows, errors };
}
