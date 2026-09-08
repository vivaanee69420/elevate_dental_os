// ============================================================================
// Chair metrics — occupancy, coverage, and the cost of empty chairs.
//
// THE DEFECT THIS FIXES. The previous implementation took occupancy from the
// cells someone had entered, but took capacity from chair_config
// (chairs x openHrs x weeksYr x daysWk) and never read the entered minutes at
// all. Ashford's grid described 28 open hours a week; the config asserted 80;
// the money came off the 80. That produced a GBP 230,041 "recoverable" claim
// from 14% coverage, and let Barnet report 100% occupancy with GBP 0 cost of
// empty chairs off a SINGLE Monday-morning cell.
//
// Here, occupancy and money come from the SAME cell set: the open cells that
// actually have an entry. That makes the ratio honest and bounds the money by
// what is genuinely known, and the coverage figure travels with every number
// so a reader can see what it is based on.
//
// NULL IS NOT ZERO, everywhere. A cost per nothing is unknowable, not free.
// Pure module — no I/O.
// ============================================================================
import { daySlotMinutes, slotIndexOf } from './chair-slots.js';

/** Below this coverage, the MONEY figures are withheld. Occupancy still shows,
 *  carrying its coverage badge — a ratio over a small sample is weak evidence,
 *  but an annualised pound figure over one is an invention. */
export const COVERAGE_THRESHOLD_PCT = 50;

const round1 = (n) => Math.round(n * 10) / 10;

/** Available minutes per (weekday, slotIndex) for one chair, from opening hours. */
function availabilityByDay(openingHours) {
    const byWeekday = new Map();
    for (const h of openingHours ?? []) {
        byWeekday.set(Number(h.weekday), daySlotMinutes(h.openMinute, h.closeMinute));
    }
    return byWeekday;
}

export function practiceChairMetrics({
    chairs = [],
    openingHours = [],
    cells = [],
    weeksYr,
    benchOccPct,
    benchRevHrPence,
} = {}) {
    const activeChairs = (chairs ?? []).filter((c) => c.active !== false);
    const availability = availabilityByDay(openingHours);

    // Open cells: every (active chair x weekday x slot) with a non-zero window.
    // A weekday the practice is shut contributes nothing to the denominator, so
    // a six-day practice is not penalised for not opening on Sunday.
    let openSlotsPerChair = 0;
    for (const mins of availability.values()) {
        for (const m of mins) if (m > 0) openSlotsPerChair++;
    }
    const openCells = openSlotsPerChair * activeChairs.length;
    // Deliberately NOT `openCells > 0`. A practice with real opening hours but
    // no chairs yet has zero open cells, and deriving this from that would make
    // it report "no opening hours set" — false, and pointing the owner at the
    // wrong fix. The two states are distinct and the UI says which is which.
    const hasOpeningHours = openSlotsPerChair > 0;

    const activeIds = new Set(activeChairs.map((c) => c.id));
    let enteredCells = 0;
    let closedCellEntries = 0;
    let overbookedCells = 0;
    let availableMinutesWk = 0;
    let bookedMinutesWk = 0;
    let revenuePence = 0;

    for (const cell of cells ?? []) {
        // A retired chair's history stays readable but contributes no capacity.
        if (!activeIds.has(cell.chair_id)) continue;
        const slotIndex = slotIndexOf(cell.slot);
        if (slotIndex < 0) continue;
        const mins = availability.get(Number(cell.weekday));
        const available = mins ? mins[slotIndex] : 0;

        if (available <= 0) {
            // An entry in a slot the practice is shut for. Counted and surfaced
            // rather than silently dropped: it usually means the opening hours
            // changed under data that had already been entered.
            closedCellEntries++;
            continue;
        }

        const rawBooked = Math.max(0, Number(cell.booked_minutes) || 0);
        if (rawBooked > available) overbookedCells++;
        // Clamp: occupancy over 100% is not a real reading, and shortening the
        // opening hours must not retroactively invent booked time.
        const booked = Math.min(rawBooked, available);

        enteredCells++;
        availableMinutesWk += available;
        bookedMinutesWk += booked;
        revenuePence += Math.max(0, Number(cell.revenue_pence) || 0);
    }

    return finalise({
        hasOpeningHours,
        chairs: activeChairs.length,
        openCells,
        enteredCells,
        closedCellEntries,
        overbookedCells,
        availableMinutesWk,
        bookedMinutesWk,
        revenuePence,
    }, { weeksYr, benchOccPct, benchRevHrPence });
}

/** Group rollup. Sums the entered-cell minutes across practices and re-derives
 *  the blended figures from those sums — never an average of averages, which
 *  would weight a one-cell practice equally with a fully-entered one. */
export function rollupChairMetrics(rows = [], { weeksYr, benchOccPct, benchRevHrPence } = {}) {
    const sum = (f) => rows.reduce((s, r) => s + (f(r) || 0), 0);
    return finalise({
        hasOpeningHours: rows.some((r) => r.hasOpeningHours),
        chairs: sum((r) => r.chairs),
        openCells: sum((r) => r.openCells),
        enteredCells: sum((r) => r.enteredCells),
        closedCellEntries: sum((r) => r.closedCellEntries),
        overbookedCells: sum((r) => r.overbookedCells),
        availableMinutesWk: sum((r) => r.availableMinutesWk),
        bookedMinutesWk: sum((r) => r.bookedMinutesWk),
        revenuePence: sum((r) => r.revenuePence),
    }, { weeksYr, benchOccPct, benchRevHrPence });
}

/** Derive every ratio and money figure from the accumulated minutes, applying
 *  the null rules in one place so a practice row and a group rollup cannot
 *  disagree about when a number is unknowable. */
function finalise(base, { weeksYr, benchOccPct, benchRevHrPence }) {
    const { openCells, enteredCells, availableMinutesWk, bookedMinutesWk, revenuePence } = base;

    const coveragePct = openCells > 0 ? Math.round((100 * enteredCells) / openCells) : null;
    const emptyMinutesWk = Math.max(0, availableMinutesWk - bookedMinutesWk);

    const occupancyPct = availableMinutesWk > 0
        ? round1((100 * bookedMinutesWk) / availableMinutesWk)
        : null;

    const bookedHrsWk = bookedMinutesWk / 60;
    const revPerBookedHrPence = bookedHrsWk > 0 ? Math.round(revenuePence / bookedHrsWk) : null;

    // Money is withheld below the threshold. Returning 0 would read as "nothing
    // is being lost" when the truth is "we have not been told enough to say".
    const moneyKnown = coveragePct != null
        && coveragePct >= COVERAGE_THRESHOLD_PCT
        && occupancyPct != null;

    let lostPotentialYrPence = null;
    let recoverRevYrPence = null;
    if (moneyKnown) {
        lostPotentialYrPence = Math.round((emptyMinutesWk / 60) * weeksYr * benchRevHrPence);
        const gapPct = Math.max(0, benchOccPct - occupancyPct);
        const recoverHrsYr = (availableMinutesWk / 60) * weeksYr * (gapPct / 100);
        recoverRevYrPence = Math.round(recoverHrsYr * (revPerBookedHrPence ?? 0));
    }

    return {
        ...base,
        coveragePct,
        emptyMinutesWk,
        occupancyPct,
        revPerBookedHrPence,
        lostPotentialYrPence,
        recoverRevYrPence,
    };
}
