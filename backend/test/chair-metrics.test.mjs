// Coverage-aware chair metrics.
//
// The Ashford and Barnet cases below are the NINE REAL cells that exist on
// hosted, run against the REAL opening hours those practices have in Dentally.
// They are regression fixtures: today the same inputs produce 71.4% / GBP
// 230,041 recoverable for Ashford and 100% / GBP 0 for Barnet.
import { describe, it, expect } from 'vitest';
import {
    COVERAGE_THRESHOLD_PCT, practiceChairMetrics, rollupChairMetrics,
} from '../src/lib/chair-metrics.js';

const CFG = { weeksYr: 46, benchOccPct: 88, benchRevHrPence: 30000 };

// Ashford: open 09:00-17:00 (540-1020) Mon-Sat, closed Sunday.
const ASHFORD_HOURS = [1, 2, 3, 4, 5, 6]
    .map((weekday) => ({ weekday, openMinute: 540, closeMinute: 1020 }))
    .concat([{ weekday: 7, openMinute: null, closeMinute: null }]);

const ASHFORD_CELLS = [
    { chair_id: 'c1', weekday: 1, slot: 'morning', booked_minutes: 150, revenue_pence: 95000 },
    { chair_id: 'c1', weekday: 1, slot: 'afternoon', booked_minutes: 180, revenue_pence: 110000 },
    { chair_id: 'c1', weekday: 2, slot: 'morning', booked_minutes: 120, revenue_pence: 72000 },
    { chair_id: 'c1', weekday: 3, slot: 'afternoon', booked_minutes: 210, revenue_pence: 130000 },
    { chair_id: 'c2', weekday: 1, slot: 'morning', booked_minutes: 180, revenue_pence: 120000 },
    { chair_id: 'c2', weekday: 2, slot: 'afternoon', booked_minutes: 150, revenue_pence: 90000 },
    { chair_id: 'c2', weekday: 4, slot: 'morning', booked_minutes: 120, revenue_pence: 76000 },
    { chair_id: 'c2', weekday: 5, slot: 'evening', booked_minutes: 90, revenue_pence: 60000 },
];

const ashford = () => practiceChairMetrics({
    chairs: [{ id: 'c1', active: true }, { id: 'c2', active: true }],
    openingHours: ASHFORD_HOURS,
    cells: ASHFORD_CELLS,
    ...CFG,
});

describe('Ashford — the live cells against real opening hours', () => {
    it('counts 36 open cells: the evening slot is shut, so 3 slots x 6 days x 2 chairs', () => {
        expect(ashford().openCells).toBe(36);
    });

    it('the Friday-evening entry lands in a CLOSED slot and is excluded', () => {
        const m = ashford();
        expect(m.closedCellEntries).toBe(1);
        expect(m.enteredCells).toBe(7);
    });

    it('flags the three open cells booked beyond the practice opening hours', () => {
        // Mon morning on both chairs and Wed afternoon record more booked time
        // than the practice is open for. This is what hand-typed available
        // minutes with nothing to check them against produces.
        expect(ashford().overbookedCells).toBe(3);
    });

    it('clamps booked to available, giving 97.1% on 990 of 1020 minutes', () => {
        const m = ashford();
        expect(m.availableMinutesWk).toBe(1020);
        expect(m.bookedMinutesWk).toBe(990);
        expect(m.emptyMinutesWk).toBe(30);
        expect(m.occupancyPct).toBe(97.1);
    });

    it('reports 19% coverage and SUPPRESSES money below the threshold', () => {
        const m = ashford();
        expect(m.coveragePct).toBe(19);
        // null, not 0. A zero here reads as "nothing is being lost", which is
        // the opposite of "we do not know yet".
        expect(m.lostPotentialYrPence).toBeNull();
        expect(m.recoverRevYrPence).toBeNull();
    });

    it('still reports yield per booked hour, which does not depend on coverage', () => {
        expect(ashford().revPerBookedHrPence).toBe(42000);
    });
});

describe('Barnet — one cell must stop reading as a perfect practice', () => {
    const barnet = () => practiceChairMetrics({
        chairs: [{ id: 'b1', active: true }],
        openingHours: [1, 2, 3, 4, 5]
            .map((weekday) => ({ weekday, openMinute: 510, closeMinute: 1050 }))
            .concat([
                { weekday: 6, openMinute: 540, closeMinute: 1050 },
                { weekday: 7, openMinute: null, closeMinute: null },
            ]),
        cells: [{ chair_id: 'b1', weekday: 1, slot: 'morning', booked_minutes: 120, revenue_pence: 29900 }],
        ...CFG,
    });

    it('24 open cells, one entered', () => {
        const m = barnet();
        expect(m.openCells).toBe(24);
        expect(m.enteredCells).toBe(1);
        expect(m.coveragePct).toBe(4);
    });

    it('reads 80% off a 150-minute morning, NOT the 100% it reports today', () => {
        const m = barnet();
        expect(m.availableMinutesWk).toBe(150);
        expect(m.bookedMinutesWk).toBe(120);
        expect(m.occupancyPct).toBe(80);
    });

    it('money is null, not the GBP 0 cost-of-empty it reports today', () => {
        const m = barnet();
        expect(m.lostPotentialYrPence).toBeNull();
        expect(m.recoverRevYrPence).toBeNull();
    });
});

describe('above the coverage threshold, money is computed', () => {
    // One chair open Monday only, 09:00-17:00 -> 3 open cells, 2 entered = 67%.
    const m = () => practiceChairMetrics({
        chairs: [{ id: 'x', active: true }],
        openingHours: [{ weekday: 1, openMinute: 540, closeMinute: 1020 }],
        cells: [
            { chair_id: 'x', weekday: 1, slot: 'morning', booked_minutes: 60, revenue_pence: 30000 },
            { chair_id: 'x', weekday: 1, slot: 'midday', booked_minutes: 180, revenue_pence: 90000 },
        ],
        ...CFG,
    });

    it('coverage clears the threshold', () => {
        expect(m().coveragePct).toBe(67);
        expect(COVERAGE_THRESHOLD_PCT).toBe(50);
    });

    it('cost of empty = idle hours x weeks x benchmark rate', () => {
        // 60 idle min/wk = 1 h -> 1 x 46 x GBP 300 = GBP 13,800.
        expect(m().lostPotentialYrPence).toBe(1380000);
    });

    it('recoverable climbs to the benchmark at the practice OWN yield', () => {
        // capacity 300 min/wk = 5 h -> 5 x 46 x (88-80)/100 = 18.4 h @ GBP 300.
        expect(m().revPerBookedHrPence).toBe(30000);
        expect(m().recoverRevYrPence).toBe(552000);
    });
});

describe('edge cases', () => {
    it('no opening hours at all -> everything null, never a confident zero', () => {
        const m = practiceChairMetrics({
            chairs: [{ id: 'x', active: true }], openingHours: [], cells: [], ...CFG,
        });
        expect(m.hasOpeningHours).toBe(false);
        expect(m.openCells).toBe(0);
        expect(m.coveragePct).toBeNull();
        expect(m.occupancyPct).toBeNull();
        expect(m.lostPotentialYrPence).toBeNull();
        expect(m.recoverRevYrPence).toBeNull();
        expect(m.revPerBookedHrPence).toBeNull();
    });

    it('open hours but nothing entered -> occupancy null, not 0%', () => {
        const m = practiceChairMetrics({
            chairs: [{ id: 'x', active: true }],
            openingHours: [{ weekday: 1, openMinute: 540, closeMinute: 1020 }],
            cells: [], ...CFG,
        });
        expect(m.openCells).toBe(3);
        expect(m.coveragePct).toBe(0);
        expect(m.occupancyPct).toBeNull();
        expect(m.lostPotentialYrPence).toBeNull();
    });

    it('retired chairs contribute no capacity and no coverage denominator', () => {
        const m = practiceChairMetrics({
            chairs: [{ id: 'live', active: true }, { id: 'gone', active: false }],
            openingHours: [{ weekday: 1, openMinute: 540, closeMinute: 1020 }],
            cells: [{ chair_id: 'gone', weekday: 1, slot: 'morning', booked_minutes: 60, revenue_pence: 0 }],
            ...CFG,
        });
        expect(m.chairs).toBe(1);
        expect(m.openCells).toBe(3);
        expect(m.enteredCells).toBe(0); // the retired chair's cell is not counted
    });

    it('zero booked minutes -> yield is null, not free', () => {
        const m = practiceChairMetrics({
            chairs: [{ id: 'x', active: true }],
            openingHours: [{ weekday: 1, openMinute: 540, closeMinute: 1020 }],
            cells: [
                { chair_id: 'x', weekday: 1, slot: 'morning', booked_minutes: 0, revenue_pence: 0 },
                { chair_id: 'x', weekday: 1, slot: 'midday', booked_minutes: 0, revenue_pence: 0 },
            ],
            ...CFG,
        });
        expect(m.bookedMinutesWk).toBe(0);
        expect(m.revPerBookedHrPence).toBeNull();
    });

    it('occupancy at or above the benchmark clamps recoverable to zero', () => {
        const m = practiceChairMetrics({
            chairs: [{ id: 'x', active: true }],
            openingHours: [{ weekday: 1, openMinute: 540, closeMinute: 1020 }],
            cells: [
                { chair_id: 'x', weekday: 1, slot: 'morning', booked_minutes: 120, revenue_pence: 60000 },
                { chair_id: 'x', weekday: 1, slot: 'midday', booked_minutes: 180, revenue_pence: 90000 },
                { chair_id: 'x', weekday: 1, slot: 'afternoon', booked_minutes: 180, revenue_pence: 90000 },
            ],
            ...CFG,
        });
        expect(m.occupancyPct).toBe(100);
        expect(m.recoverRevYrPence).toBe(0);
        expect(m.lostPotentialYrPence).toBe(0);
    });

    it('an unknown slot key is ignored rather than crashing the practice', () => {
        const m = practiceChairMetrics({
            chairs: [{ id: 'x', active: true }],
            openingHours: [{ weekday: 1, openMinute: 540, closeMinute: 1020 }],
            cells: [{ chair_id: 'x', weekday: 1, slot: 'teatime', booked_minutes: 60, revenue_pence: 0 }],
            ...CFG,
        });
        expect(m.enteredCells).toBe(0);
    });
});

describe('rollupChairMetrics', () => {
    it('sums the entered-cell minutes and re-derives blended occupancy', () => {
        const a = practiceChairMetrics({
            chairs: [{ id: 'a', active: true }],
            openingHours: [{ weekday: 1, openMinute: 540, closeMinute: 1020 }],
            cells: [{ chair_id: 'a', weekday: 1, slot: 'midday', booked_minutes: 90, revenue_pence: 45000 }],
            ...CFG,
        });
        const b = practiceChairMetrics({
            chairs: [{ id: 'b', active: true }],
            openingHours: [{ weekday: 1, openMinute: 540, closeMinute: 1020 }],
            cells: [{ chair_id: 'b', weekday: 1, slot: 'midday', booked_minutes: 180, revenue_pence: 90000 }],
            ...CFG,
        });
        const g = rollupChairMetrics([a, b], CFG);
        expect(g.chairs).toBe(2);
        expect(g.openCells).toBe(6);
        expect(g.enteredCells).toBe(2);
        expect(g.availableMinutesWk).toBe(360);
        expect(g.bookedMinutesWk).toBe(270);
        expect(g.occupancyPct).toBe(75);
        expect(g.coveragePct).toBe(33);
    });

    it('an empty group is null everywhere, not zero', () => {
        const g = rollupChairMetrics([], CFG);
        expect(g.occupancyPct).toBeNull();
        expect(g.coveragePct).toBeNull();
        expect(g.lostPotentialYrPence).toBeNull();
    });
});
