// ============================================================================
// Practitioner performance — the page is a composition, so what needs pinning
// is not the arithmetic but the joins and the nulls.
//
// Three ways a plausible-looking row here would be wrong:
//
//   1. Time and treatments joined on DIFFERENT identities. Utilisation is keyed
//      on pms_practitioner_id and the treatment feed could as easily have been
//      keyed on associate_id; one clinician would then appear as two rows, both
//      looking reasonable.
//   2. A missing FEED read as a zero. "This database has no completed-treatment
//      rows" and "this clinician completed nothing" are different facts, and a
//      league table that shows 0 for the first is defaming somebody.
//   3. Totals averaged instead of pooled. One part-timer at 100% must not weigh
//      the same as a full-timer at 40%.
// ============================================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { practitionerPerformanceService } from '../src/services/practitioner-performance.service.js';
import { practitionerUtilisationRepository } from '../src/repositories/practitioner-utilisation.repository.js';

const ORG = '11111111-1111-1111-1111-111111111111';
const H = 3600;

const day = (o) => ({
    practitioner_id: 'p1', practitioner_name: 'A Clinician', practice_id: null,
    day: '2026-09-01', available_secs: 8 * H, clinical_secs: 4 * H, utilised_secs: 4 * H,
    rota_secs: 8 * H, rota_break_secs: 0, rostered: true,
    patient_appts: 4, block_appts: 0, revenue_pence: 50000, ...o,
});
const win = (o = {}) => ({ since: '2026-09-01', until: '2026-09-30', basis: 'rota', ...o });

/** Stub all three repository reads. `treatments: null` = feed unavailable. */
function stub(days, treatments, top = []) {
    vi.spyOn(practitionerUtilisationRepository, 'daily').mockResolvedValue(days);
    vi.spyOn(practitionerUtilisationRepository, 'treatmentsByPractitioner').mockResolvedValue(treatments);
    vi.spyOn(practitionerUtilisationRepository, 'topTreatments').mockResolvedValue(top);
}

beforeEach(() => { vi.restoreAllMocks(); });

describe('time, treatment and money land on ONE row', () => {
    it('joins the treatment feed on the same practitioner id the diary uses', async () => {
        stub(
            [day({ practitioner_id: '201099', utilised_secs: 4 * H, rota_secs: 8 * H, revenue_pence: 120000 })],
            [{ practitioner_id: '201099', treatments: 7, patients: 5, value_pence: 95000, duration_minutes: 210 }],
        );
        const r = await practitionerPerformanceService.overview(ORG, win());
        expect(r.practitioners).toHaveLength(1);
        const p = r.practitioners[0];
        expect(p.utilisedHours).toBe(4);
        expect(p.treatments).toBe(7);
        expect(p.revenuePence).toBe(120000);
        // Invoiced fees and treatment list value are DIFFERENT columns and stay
        // different — collapsing them would hide the gap that is the point.
        expect(p.treatmentValuePence).toBe(95000);
    });

    // The join is by id, so an id present in one feed and absent from the other
    // must not silently borrow another clinician's numbers.
    it('leaves a clinician with no treatment rows at zero, not at somebody else’s figures', async () => {
        stub(
            [
                day({ practitioner_id: 'a', practitioner_name: 'A', revenue_pence: 10000 }),
                day({ practitioner_id: 'b', practitioner_name: 'B', revenue_pence: 20000 }),
            ],
            [{ practitioner_id: 'a', treatments: 3, patients: 3, value_pence: 9000, duration_minutes: 60 }],
        );
        const r = await practitionerPerformanceService.overview(ORG, win());
        const b = r.practitioners.find((x) => x.practitionerId === 'b');
        expect(b.treatments).toBe(0);
        expect(b.treatmentValuePence).toBe(0);
    });
});

describe('a missing feed is not a zero', () => {
    // FAILURE 2. The repository returns null when the RPC is unavailable.
    it('reports null treatments and says the feed is unavailable', async () => {
        stub([day()], null);
        const r = await practitionerPerformanceService.overview(ORG, win());
        expect(r.treatmentsAvailable).toBe(false);
        expect(r.practitioners[0].treatments).toBeNull();
        expect(r.practitioners[0].treatmentValuePence).toBeNull();
        expect(r.totals.treatments).toBeNull();
    });

    // …and the opposite: the feed works and this clinician genuinely did none.
    it('reports zero when the feed works and there is nothing to report', async () => {
        stub([day()], []);
        const r = await practitionerPerformanceService.overview(ORG, win());
        expect(r.treatmentsAvailable).toBe(true);
        expect(r.practitioners[0].treatments).toBe(0);
        expect(r.totals.treatments).toBe(0);
    });
});

describe('rates are null on a zero denominator', () => {
    // A cost or a rate per nothing is an em dash, never £0.00 — money() would
    // render a zero here with no type error at all.
    it('returns null for every per-hour figure when no hours were used', async () => {
        stub([day({ utilised_secs: 0, patient_appts: 1, revenue_pence: 0, rota_secs: 8 * H })], []);
        const r = await practitionerPerformanceService.overview(ORG, win());
        const p = r.practitioners[0];
        expect(p.revenuePerUtilisedHourPence).toBeNull();
        expect(p.treatmentsPerUtilisedHour).toBeNull();
        expect(p.utilisationPct).toBe(0);   // rostered 8h, used 0 — a REAL zero
    });

    it('returns null utilisation, not zero, when there is no rostered window', async () => {
        stub([day({ rota_secs: null, rota_break_secs: null, rostered: null })], []);
        const r = await practitionerPerformanceService.overview(ORG, win());
        expect(r.practitioners[0].availableHours).toBe(0);
        expect(r.practitioners[0].utilisationPct).toBeNull();
        expect(r.totals.utilisationPct).toBeNull();
    });

    it('leaves revenue null rather than 0 when nothing was invoiced at all', async () => {
        stub([day({ revenue_pence: null })], []);
        const r = await practitionerPerformanceService.overview(ORG, win());
        expect(r.practitioners[0].revenuePence).toBeNull();
        expect(r.practitioners[0].revenuePerUtilisedHourPence).toBeNull();
    });
});

describe('who appears at all', () => {
    // The rota rosters reception and admin. They must not become rows in a
    // clinical league table, and must not drag the group figure down.
    it('excludes a rostered person who treated nobody', async () => {
        stub([
            day({ practitioner_id: 'clinician', patient_appts: 4, utilised_secs: 4 * H, rota_secs: 8 * H }),
            day({ practitioner_id: 'reception', patient_appts: 0, utilised_secs: 0, rota_secs: 8 * H, revenue_pence: null }),
        ], []);
        const r = await practitionerPerformanceService.overview(ORG, win());
        expect(r.practitioners.map((p) => p.practitionerId)).toEqual(['clinician']);
        expect(r.totals.practitioners).toBe(1);
        expect(r.totals.utilisationPct).toBe(50);   // 4h of 8h, not of 16h
    });
});

describe('totals', () => {
    // FAILURE 3. Ratio of sums. The average of 100% and 40% is 70%; the truth
    // here is 6h of 14h = 42.9%.
    it('pools the group utilisation instead of averaging the practitioners', async () => {
        stub([
            day({ practitioner_id: 'part', utilised_secs: 2 * H, rota_secs: 2 * H, patient_appts: 2, revenue_pence: 1000 }),
            day({ practitioner_id: 'full', utilised_secs: 4 * H, rota_secs: 12 * H, patient_appts: 4, revenue_pence: 1000 }),
        ], []);
        const r = await practitionerPerformanceService.overview(ORG, win());
        expect(r.practitioners.find((p) => p.practitionerId === 'part').utilisationPct).toBe(100);
        expect(r.practitioners.find((p) => p.practitionerId === 'full').utilisationPct).toBe(33.3);
        expect(r.totals.utilisationPct).toBe(42.9);          // 6h of 14h
        expect(r.totals.utilisationPct).not.toBe(66.7);      // the average
    });

    it('adds a practitioner’s days across the window rather than counting rows', async () => {
        stub([
            day({ day: '2026-09-01', utilised_secs: 3 * H, rota_secs: 6 * H, revenue_pence: 10000 }),
            day({ day: '2026-09-02', utilised_secs: 5 * H, rota_secs: 6 * H, revenue_pence: 20000 }),
        ], []);
        const r = await practitionerPerformanceService.overview(ORG, win());
        const p = r.practitioners[0];
        expect(p.daysWorked).toBe(2);
        expect(p.utilisedHours).toBe(8);
        expect(p.availableHours).toBe(12);
        expect(p.revenuePence).toBe(30000);
        expect(p.revenuePerDayPence).toBe(15000);
    });
});

describe('the basis carries through', () => {
    // The page must divide by the same thing the Utilisation screen does, or
    // the two contradict each other about one window.
    it('uses the clinical window when asked for it', async () => {
        const rows = [day({ available_secs: 10 * H, clinical_secs: 5 * H, rota_secs: 8 * H, utilised_secs: 4 * H })];
        stub(rows, []);
        expect((await practitionerPerformanceService.overview(ORG, win({ basis: 'clinical' }))).totals.utilisationPct).toBe(80);
        stub(rows, []);
        expect((await practitionerPerformanceService.overview(ORG, win({ basis: 'span' }))).totals.utilisationPct).toBe(40);
        stub(rows, []);
        expect((await practitionerPerformanceService.overview(ORG, win({ basis: 'rota' }))).totals.utilisationPct).toBe(50);
    });

    it('echoes the basis back so the page can say which one is in use', async () => {
        stub([day()], []);
        const r = await practitionerPerformanceService.overview(ORG, win({ basis: 'span' }));
        expect(r.basis).toBe('span');
        expect(r.window).toEqual({ since: '2026-09-01', until: '2026-09-30' });
    });
});

describe('the most repeated treatment', () => {
    it('carries the practitioner’s top treatment and its count', async () => {
        stub(
            [day({ practitioner_id: 'a' })],
            [{
                practitioner_id: 'a', treatments: 40, patients: 30, value_pence: 500000,
                duration_minutes: 900, top_treatment: 'Examination', top_treatment_count: 22,
            }],
        );
        const r = await practitionerPerformanceService.overview(ORG, win());
        expect(r.practitioners[0].topTreatment).toBe('Examination');
        expect(r.practitioners[0].topTreatmentCount).toBe(22);
    });

    // Every item unnamed: null, not an empty string, so the card can render a
    // dash rather than a blank that looks like a rendering fault.
    it('returns null when the feed named nothing', async () => {
        stub(
            [day({ practitioner_id: 'a' })],
            [{ practitioner_id: 'a', treatments: 3, patients: 3, value_pence: 0, duration_minutes: 0, top_treatment: null, top_treatment_count: null }],
        );
        const r = await practitionerPerformanceService.overview(ORG, win());
        expect(r.practitioners[0].topTreatment).toBeNull();
        expect(r.practitioners[0].topTreatmentCount).toBeNull();
    });

    // THE REASON the group's top is its own read. Two clinicians whose top item
    // is a different scale-and-polish can both be beaten by an examination
    // neither ranked first — so the group card must never be derived from the
    // per-practitioner winners.
    it('takes the group’s top from its own read, not from the practitioners’ tops', async () => {
        stub(
            [day({ practitioner_id: 'a' }), day({ practitioner_id: 'b' })],
            [
                { practitioner_id: 'a', treatments: 10, patients: 8, value_pence: 0, duration_minutes: 0, top_treatment: 'Scale and polish', top_treatment_count: 5 },
                { practitioner_id: 'b', treatments: 10, patients: 8, value_pence: 0, duration_minutes: 0, top_treatment: 'Filling', top_treatment_count: 4 },
            ],
            [{ treatment_name: 'Examination', treatments: 9, patients: 9, value_pence: 12000 }],
        );
        const r = await practitionerPerformanceService.overview(ORG, win());
        // Neither practitioner ranked it first, and it still wins the group.
        expect(r.topTreatments[0].treatmentName).toBe('Examination');
        expect(r.topTreatments[0].treatments).toBe(9);
    });

    it('returns an empty list rather than throwing when that read is unavailable', async () => {
        stub([day()], [], null);
        const r = await practitionerPerformanceService.overview(ORG, win());
        expect(r.topTreatments).toEqual([]);
    });
});

describe('tenant isolation', () => {
    // The organisation reaches the repository from the caller and is never
    // taken from a row. Asserted by RUNNING it, not by reading the code.
    it('passes the caller’s organisation to both reads and nothing else', async () => {
        const daily = vi.spyOn(practitionerUtilisationRepository, 'daily').mockResolvedValue([day()]);
        const treat = vi.spyOn(practitionerUtilisationRepository, 'treatmentsByPractitioner').mockResolvedValue([]);
        const top = vi.spyOn(practitionerUtilisationRepository, 'topTreatments').mockResolvedValue([]);
        await practitionerPerformanceService.overview(ORG, win({ practiceId: 'prac-1' }));
        const expected = { since: '2026-09-01', until: '2026-09-30', practiceId: 'prac-1' };
        expect(daily).toHaveBeenCalledWith(ORG, expected);
        expect(treat).toHaveBeenCalledWith(ORG, expected);
        expect(top).toHaveBeenCalledWith(ORG, expected);
    });
});
