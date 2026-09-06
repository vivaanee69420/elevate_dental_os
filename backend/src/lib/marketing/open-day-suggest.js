// ============================================================================
// Which open day a newly-seen campaign or pipeline probably belongs to.
//
// A SUGGESTION, NEVER A MAPPING. The caller pre-ticks a checkbox with this and
// writes nothing until a human confirms. That is the whole difference between
// this and the name matching that has burned this codebase twice — practice
// names, and Emergent's fuzzy business match. A name is a shortcut for a
// person; it is never the stored answer.
//
// It fails SILENT: an unrecognised name returns null, so a tenant whose naming
// this does not understand ticks boxes by hand rather than getting a wrong
// event. The cost of a miss is a missing shortcut; the cost of a false match
// would be an event's numbers quietly wrong.
// ============================================================================
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december'];

function monthsIn(text) {
    const found = new Set();
    // Whole words only. A leading-boundary stem match ("\bmay") also matches
    // inside "Mayfair", "Junction", "Marchmont" — real London-district and
    // plausible campaign/practice names for a UK dental group. A word only
    // counts as a month when the ENTIRE word is a prefix (>= 3 letters) of
    // that month's own name, so "Aug"/"August"/"Sept"/"September" all match
    // but a longer word that merely starts the same way never does.
    const words = String(text).match(/[A-Za-z]+/g) ?? [];
    for (const word of words) {
        const w = word.toLowerCase();
        if (w.length < 3) continue;
        for (let i = 0; i < MONTHS.length; i++) {
            if (MONTHS[i].startsWith(w)) { found.add(i + 1); break; }
        }
    }
    for (const m of text.matchAll(/\b(0?[1-9]|1[0-2])\s*\/\s*(\d{2,4})\b/g)) {
        found.add(Number(m[1]));
    }
    return found;
}

function yearsIn(text) {
    const found = new Set();
    for (const m of text.matchAll(/\b(20)?(\d{2})\b/g)) {
        const y = Number(m[2]);
        if (y >= 20 && y <= 99) found.add(2000 + y);
    }
    return found;
}

export function suggestOpenDay(name, events) {
    const text = String(name ?? '');
    // Real campaign names vary the separator — "OpenDay", "Open Day",
    // "Open  Day" (double space), "Open-Day" — but it is still anchored to
    // the two words themselves, never loosened to match "day" on its own.
    if (!/open[\s-]*day/i.test(text)) return null;
    if (!events?.length) return null;

    const months = monthsIn(text);
    const years = yearsIn(text);
    if (months.size === 0) return null;

    const matches = events.filter((e) => {
        const candidate = `${e.name ?? ''} ${e.eventDate ?? ''}`;
        const eventMonths = e.eventDate
            ? new Set([Number(e.eventDate.slice(5, 7))])
            : monthsIn(candidate);
        const eventYears = e.eventDate
            ? new Set([Number(e.eventDate.slice(0, 4))])
            : yearsIn(candidate);
        const monthHit = [...months].some((m) => eventMonths.has(m));
        const yearHit = years.size === 0 || eventYears.size === 0
            || [...years].some((y) => eventYears.has(y));
        return monthHit && yearHit;
    });

    // Exactly one, or nothing. An ambiguous name is precisely when a guess is
    // most likely to be wrong.
    return matches.length === 1 ? matches[0].id : null;
}
