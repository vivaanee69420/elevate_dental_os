// ============================================================================
// Chair capacity — the single place chairs, opening hours and entered cells
// meet. Both consumers read it: the entry page (which needs the derived
// available minutes per cell) and chairAnalytics (which needs the metrics).
// One composition means the page you type into and the page you read cannot
// disagree about how much capacity a practice has.
//
// Three whole-org reads, joined in memory -- never one read per practice.
// ============================================================================
import { practiceChairRepository } from "../repositories/practice-chair.repository.js";
import { practiceOpeningHoursRepository } from "../repositories/practice-opening-hours.repository.js";
import { chairUtilisationRepository } from "../repositories/chair-utilisation.repository.js";
import { SLOTS, daySlotMinutes } from "../lib/chair-slots.js";
import { practiceChairMetrics } from "../lib/chair-metrics.js";

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];

/** Repository rows use snake_case columns; the metrics library takes camelCase
 *  minutes. One adapter, so the shape conversion lives in exactly one place. */
const toHours = (rows) => (rows ?? []).map((h) => ({
    weekday: Number(h.weekday),
    openMinute: h.open_minute,
    closeMinute: h.close_minute,
}));

export const chairCapacityService = {
    /** One practice's editable week: every chair, every weekday, every slot,
     *  with available minutes derived and booked minutes as entered. */
    async practiceWeek(orgId, practiceId) {
        const [chairs, hourRows, cells] = await Promise.all([
            practiceChairRepository.listForPractice(orgId, practiceId),
            practiceOpeningHoursRepository.listForPractice(orgId, practiceId),
            chairUtilisationRepository.list(orgId, practiceId),
        ]);

        const openingHours = toHours(hourRows);
        const minutesByWeekday = new Map(
            openingHours.map((h) => [h.weekday, daySlotMinutes(h.openMinute, h.closeMinute)]),
        );

        const entered = new Map();
        for (const c of cells) {
            entered.set(`${c.chair_id}|${c.weekday}|${c.slot}`, c);
        }

        const activeChairs = chairs.filter((c) => c.active !== false);
        const weekByChair = {};
        let openCells = 0;
        let enteredCells = 0;

        for (const chair of activeChairs) {
            const byWeekday = {};
            for (const weekday of WEEKDAYS) {
                const mins = minutesByWeekday.get(weekday) ?? SLOTS.map(() => 0);
                const bySlot = {};
                SLOTS.forEach((slot, i) => {
                    const availableMinutes = mins[i];
                    const row = entered.get(`${chair.id}|${weekday}|${slot}`);
                    const bookedMinutes = row ? Math.max(0, Number(row.booked_minutes) || 0) : null;
                    if (availableMinutes > 0) {
                        openCells++;
                        if (row) enteredCells++;
                    }
                    bySlot[slot] = {
                        availableMinutes,
                        // null (not 0) when nothing has been entered: an empty
                        // cell is unknown, and rendering it as a booked zero
                        // would be a claim nobody made.
                        bookedMinutes,
                        revenuePence: row ? Math.max(0, Number(row.revenue_pence) || 0) : null,
                        notes: row?.notes ?? null,
                        overbooked: bookedMinutes != null && bookedMinutes > availableMinutes,
                    };
                });
                byWeekday[weekday] = bySlot;
            }
            weekByChair[chair.id] = byWeekday;
        }

        return {
            chairs: activeChairs.map((c) => ({
                id: c.id, name: c.name, displayOrder: c.display_order ?? 0,
            })),
            openingHours: hourRows ?? [],
            // The server owns the slot vocabulary; the client renders what it
            // is sent rather than keeping a second copy that can drift.
            slots: [...SLOTS],
            weekByChair,
            coverage: {
                openCells,
                enteredCells,
                coveragePct: openCells > 0 ? Math.round((100 * enteredCells) / openCells) : null,
            },
        };
    },

    /** Coverage-aware metrics for every requested practice. A practice with no
     *  data is PRESENT with null figures, never absent — an absent key renders
     *  as nothing, a null one renders as "not set up yet". */
    async metricsByPractice(orgId, practiceIds, config) {
        const [chairs, hourRows, cells] = await Promise.all([
            practiceChairRepository.listAll(orgId),
            practiceOpeningHoursRepository.listAll(orgId),
            chairUtilisationRepository.listAll(orgId),
        ]);

        const group = (rows) => {
            const m = new Map();
            for (const r of rows ?? []) {
                if (!m.has(r.practice_id)) m.set(r.practice_id, []);
                m.get(r.practice_id).push(r);
            }
            return m;
        };
        const chairsBy = group(chairs);
        const hoursBy = group(hourRows);
        const cellsBy = group(cells);

        const out = new Map();
        for (const practiceId of practiceIds) {
            out.set(practiceId, practiceChairMetrics({
                chairs: (chairsBy.get(practiceId) ?? []).map((c) => ({ id: c.id, active: c.active })),
                openingHours: toHours(hoursBy.get(practiceId) ?? []),
                cells: cellsBy.get(practiceId) ?? [],
                ...config,
            }));
        }
        return out;
    },
};
