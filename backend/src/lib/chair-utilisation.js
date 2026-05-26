// ============================================================================
// Chair utilisation — pure grid aggregation. Sums manual booked/available
// minutes per (weekday, slot) across all chairs, computes utilisation % and
// KPIs. No I/O; unit-tested in isolation.
// ============================================================================

export const SLOTS = ['morning', 'midday', 'afternoon', 'evening'];
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7]; // ISO Mon..Sun

export function aggregateGrid(records) {
    const grid = SLOTS.map(() =>
        WEEKDAYS.map(() => ({ bookedMin: 0, availableMin: 0, pct: null })),
    );
    for (const r of records) {
        const si = SLOTS.indexOf(r.slot);
        const di = WEEKDAYS.indexOf(Number(r.weekday));
        if (si < 0 || di < 0) continue;
        const cell = grid[si][di];
        cell.bookedMin += Number(r.booked_minutes) || 0;
        cell.availableMin += Number(r.available_minutes) || 0;
    }

    let idleMin = 0;
    const pcts = [];
    for (let si = 0; si < SLOTS.length; si++) {
        for (let di = 0; di < WEEKDAYS.length; di++) {
            const cell = grid[si][di];
            idleMin += Math.max(0, cell.availableMin - cell.bookedMin);
            if (cell.availableMin > 0) {
                cell.pct = Math.min(100, Math.round((100 * cell.bookedMin) / cell.availableMin));
                pcts.push({ weekday: WEEKDAYS[di], slot: SLOTS[si], pct: cell.pct });
            }
        }
    }

    const avgUtilPct = pcts.length
        ? Math.round(pcts.reduce((s, p) => s + p.pct, 0) / pcts.length)
        : null;
    const peakSlot = pcts.length ? pcts.reduce((a, b) => (b.pct > a.pct ? b : a)) : null;
    const lowestSlot = pcts.length ? pcts.reduce((a, b) => (b.pct < a.pct ? b : a)) : null;
    const idleChairHours = Math.round((idleMin / 60) * 10) / 10;

    return {
        days: [...WEEKDAYS],
        slots: [...SLOTS],
        grid,
        kpis: { avgUtilPct, peakSlot, lowestSlot, idleChairHours },
    };
}
