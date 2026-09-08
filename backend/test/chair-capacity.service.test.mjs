// The capacity service composes chairs + opening hours + entered cells. It is
// the only place those three meet, so it is where a practice with no opening
// hours must resolve to "unknown" rather than to a confident zero.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/repositories/practice-chair.repository.js', () => ({
    practiceChairRepository: { listForPractice: vi.fn(), listAll: vi.fn() },
}));
vi.mock('../src/repositories/practice-opening-hours.repository.js', () => ({
    practiceOpeningHoursRepository: { listForPractice: vi.fn(), listAll: vi.fn() },
}));
vi.mock('../src/repositories/chair-utilisation.repository.js', () => ({
    chairUtilisationRepository: { list: vi.fn(), listAll: vi.fn() },
}));

const { practiceChairRepository } = await import('../src/repositories/practice-chair.repository.js');
const { practiceOpeningHoursRepository } = await import('../src/repositories/practice-opening-hours.repository.js');
const { chairUtilisationRepository } = await import('../src/repositories/chair-utilisation.repository.js');
const { chairCapacityService } = await import('../src/services/chair-capacity.service.js');

const ORG = 'org-a';
const CFG = { weeksYr: 46, benchOccPct: 88, benchRevHrPence: 30000 };

// Ashford's real hours: 09:00-17:00 Mon-Sat, closed Sunday.
const ASHFORD_HOURS = [1, 2, 3, 4, 5, 6]
    .map((weekday) => ({ practice_id: 'p1', weekday, open_minute: 540, close_minute: 1020 }))
    .concat([{ practice_id: 'p1', weekday: 7, open_minute: null, close_minute: null }]);

beforeEach(() => vi.clearAllMocks());

describe('practiceWeek', () => {
    it('derives available minutes per cell from the opening hours', async () => {
        practiceChairRepository.listForPractice.mockResolvedValue([
            { id: 'c1', name: 'Surgery 1', display_order: 0, active: true },
        ]);
        practiceOpeningHoursRepository.listForPractice.mockResolvedValue(ASHFORD_HOURS);
        chairUtilisationRepository.list.mockResolvedValue([
            { chair_id: 'c1', weekday: 1, slot: 'morning', booked_minutes: 60, revenue_pence: 20000, notes: null },
        ]);

        const out = await chairCapacityService.practiceWeek(ORG, 'p1');
        const mon = out.weekByChair.c1[1];
        expect(mon.morning.availableMinutes).toBe(120);
        expect(mon.midday.availableMinutes).toBe(180);
        expect(mon.afternoon.availableMinutes).toBe(180);
        expect(mon.evening.availableMinutes).toBe(0); // shut at 17:00
        expect(mon.morning.bookedMinutes).toBe(60);
        expect(mon.morning.revenuePence).toBe(20000);
    });

    it('an unentered cell is null, not a booked zero nobody claimed', async () => {
        practiceChairRepository.listForPractice.mockResolvedValue([
            { id: 'c1', name: 'Surgery 1', display_order: 0, active: true },
        ]);
        practiceOpeningHoursRepository.listForPractice.mockResolvedValue(ASHFORD_HOURS);
        chairUtilisationRepository.list.mockResolvedValue([]);
        const out = await chairCapacityService.practiceWeek(ORG, 'p1');
        expect(out.weekByChair.c1[1].midday.bookedMinutes).toBeNull();
        expect(out.weekByChair.c1[1].midday.revenuePence).toBeNull();
    });

    it('marks a cell booked beyond the opening hours as overbooked', async () => {
        practiceChairRepository.listForPractice.mockResolvedValue([
            { id: 'c1', name: 'Surgery 1', display_order: 0, active: true },
        ]);
        practiceOpeningHoursRepository.listForPractice.mockResolvedValue(ASHFORD_HOURS);
        chairUtilisationRepository.list.mockResolvedValue([
            // The real Ashford row: 150 booked into a 120-minute morning.
            { chair_id: 'c1', weekday: 1, slot: 'morning', booked_minutes: 150, revenue_pence: 95000, notes: null },
        ]);
        const out = await chairCapacityService.practiceWeek(ORG, 'p1');
        expect(out.weekByChair.c1[1].morning.overbooked).toBe(true);
        // Shown as entered, not silently clamped: the owner must see what they
        // typed in order to correct it.
        expect(out.weekByChair.c1[1].morning.bookedMinutes).toBe(150);
    });

    it('reports coverage over OPEN cells: 1 of 18 for one chair', async () => {
        practiceChairRepository.listForPractice.mockResolvedValue([
            { id: 'c1', name: 'Surgery 1', display_order: 0, active: true },
        ]);
        practiceOpeningHoursRepository.listForPractice.mockResolvedValue(ASHFORD_HOURS);
        chairUtilisationRepository.list.mockResolvedValue([
            { chair_id: 'c1', weekday: 1, slot: 'morning', booked_minutes: 60, revenue_pence: 0, notes: null },
        ]);
        const out = await chairCapacityService.practiceWeek(ORG, 'p1');
        expect(out.coverage).toEqual({ openCells: 18, enteredCells: 1, coveragePct: 6 });
    });

    it('no opening hours -> every cell zero-available and coverage null', async () => {
        // Warwick Lodge: no pms_site_id, so no Dentally site and no hours.
        practiceChairRepository.listForPractice.mockResolvedValue([
            { id: 'c1', name: 'Surgery 1', display_order: 0, active: true },
        ]);
        practiceOpeningHoursRepository.listForPractice.mockResolvedValue([]);
        chairUtilisationRepository.list.mockResolvedValue([]);
        const out = await chairCapacityService.practiceWeek(ORG, 'p1');
        expect(out.openingHours).toEqual([]);
        expect(out.coverage).toEqual({ openCells: 0, enteredCells: 0, coveragePct: null });
    });

    it('returns the slot keys so the client never defines its own', async () => {
        practiceChairRepository.listForPractice.mockResolvedValue([]);
        practiceOpeningHoursRepository.listForPractice.mockResolvedValue([]);
        chairUtilisationRepository.list.mockResolvedValue([]);
        const out = await chairCapacityService.practiceWeek(ORG, 'p1');
        expect(out.slots).toEqual(['morning', 'midday', 'afternoon', 'evening']);
    });
});

describe('metricsByPractice', () => {
    it('reproduces the live Ashford reading: 97.1% on 7 of 36, money withheld', async () => {
        practiceChairRepository.listAll.mockResolvedValue([
            { id: 'c1', practice_id: 'p1', active: true },
            { id: 'c2', practice_id: 'p1', active: true },
        ]);
        practiceOpeningHoursRepository.listAll.mockResolvedValue(ASHFORD_HOURS);
        chairUtilisationRepository.listAll.mockResolvedValue([
            { practice_id: 'p1', chair_id: 'c1', weekday: 1, slot: 'morning', booked_minutes: 150, revenue_pence: 95000 },
            { practice_id: 'p1', chair_id: 'c1', weekday: 1, slot: 'afternoon', booked_minutes: 180, revenue_pence: 110000 },
            { practice_id: 'p1', chair_id: 'c1', weekday: 2, slot: 'morning', booked_minutes: 120, revenue_pence: 72000 },
            { practice_id: 'p1', chair_id: 'c1', weekday: 3, slot: 'afternoon', booked_minutes: 210, revenue_pence: 130000 },
            { practice_id: 'p1', chair_id: 'c2', weekday: 1, slot: 'morning', booked_minutes: 180, revenue_pence: 120000 },
            { practice_id: 'p1', chair_id: 'c2', weekday: 2, slot: 'afternoon', booked_minutes: 150, revenue_pence: 90000 },
            { practice_id: 'p1', chair_id: 'c2', weekday: 4, slot: 'morning', booked_minutes: 120, revenue_pence: 76000 },
            { practice_id: 'p1', chair_id: 'c2', weekday: 5, slot: 'evening', booked_minutes: 90, revenue_pence: 60000 },
        ]);

        const byPractice = await chairCapacityService.metricsByPractice(ORG, ['p1'], CFG);
        const m = byPractice.get('p1');
        expect(m.openCells).toBe(36);
        expect(m.enteredCells).toBe(7);
        expect(m.occupancyPct).toBe(97.1);
        expect(m.coveragePct).toBe(19);
        expect(m.lostPotentialYrPence).toBeNull();
    });

    it('a practice with no rows at all is present and null, never absent', async () => {
        // An absent key would make the caller render nothing; a null-valued one
        // makes it render "not set up yet", which is the honest state.
        practiceChairRepository.listAll.mockResolvedValue([]);
        practiceOpeningHoursRepository.listAll.mockResolvedValue([]);
        chairUtilisationRepository.listAll.mockResolvedValue([]);
        const byPractice = await chairCapacityService.metricsByPractice(ORG, ['p9'], CFG);
        expect(byPractice.has('p9')).toBe(true);
        expect(byPractice.get('p9').hasOpeningHours).toBe(false);
        expect(byPractice.get('p9').occupancyPct).toBeNull();
    });

    it('reads each table ONCE for the whole org, not once per practice', async () => {
        practiceChairRepository.listAll.mockResolvedValue([]);
        practiceOpeningHoursRepository.listAll.mockResolvedValue([]);
        chairUtilisationRepository.listAll.mockResolvedValue([]);
        await chairCapacityService.metricsByPractice(ORG, ['p1', 'p2', 'p3'], CFG);
        expect(practiceChairRepository.listAll).toHaveBeenCalledTimes(1);
        expect(practiceOpeningHoursRepository.listAll).toHaveBeenCalledTimes(1);
        expect(chairUtilisationRepository.listAll).toHaveBeenCalledTimes(1);
    });
});
