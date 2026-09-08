// ============================================================================
// Practitioner utilisation — the two judgement calls, pinned.
//
// The arithmetic here is easy; the decisions are not, and both can be wrong in
// a way that still produces a plausible number:
//
//   1. A day of nothing but blocks is "not working", not 0% utilised.
//   2. Totals are a RATIO OF SUMS, never an average of daily ratios.
//
// Measured on GM Dental Group, 1-7 September: including block-only days reads
// 15.3%, excluding them reads 70.7%, and averaging the daily percentages reads
// 68.8%. Three defensible-looking figures for one week — which is exactly why
// the choice is asserted rather than left to whoever edits this next.
// ============================================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';
import { practitionerUtilisationService } from '../src/services/practitioner-utilisation.service.js';

const ORG = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';
const H = 3600;

// available_secs is the whole diary span; clinical_secs is first-to-last
// patient. Both are returned and `basis` chooses which divides.
const row = (o) => ({
    practitioner_id: 'p1', practitioner_name: 'A Clinician', practice_id: null,
    day: '2026-09-01', available_secs: 8 * H, clinical_secs: 8 * H,
    utilised_secs: 4 * H, patient_appts: 4, block_appts: 1, revenue_pence: null, ...o,
});

// The tests written before the basis existed all reason about the diary span,
// so they ask for it explicitly rather than riding on whatever the default
// happens to be — a default that changes must not quietly rewrite what a test
// is asserting.
const span = (o = {}) => ({ since: '2026-09-01', until: '2026-09-30', basis: 'span', ...o });

beforeEach(() => { supaRec.rpcCalls = []; supaRec.rpcProvider = null; });

describe('block-only days', () => {
    // DECISION 1. A clinician who was not in is not one who sat idle. Dentally
    // exposes no rota, so a diary holding only blocks cannot tell us they were
    // rostered — counting it as 0% invents a fact.
    it('excludes a day with no patient appointments from the ratio', async () => {
        supaRec.rpcProvider = () => ({ data: [
            row({ day: '2026-09-01', available_secs: 8 * H, utilised_secs: 4 * H, patient_appts: 4 }),
            // Eight hours of blocks and no patients. Counting this would halve
            // the figure.
            row({ day: '2026-09-02', available_secs: 8 * H, utilised_secs: 0, patient_appts: 0, block_appts: 3 }),
        ], error: null });
        const r = await practitionerUtilisationService.overview(ORG, span({ until: '2026-09-02' }));
        expect(r.totals.utilisationPct).toBe(50);      // 4h of 8h, not 4h of 16h
        expect(r.totals.availableHours).toBe(8);
        expect(r.totals.daysWorked).toBe(1);
    });

    // …and SAYS it excluded them. A headline that quietly dropped most of the
    // diary would be indistinguishable from one that did not.
    it('reports what it set aside', async () => {
        supaRec.rpcProvider = () => ({ data: [
            row({ day: '2026-09-01', patient_appts: 4 }),
            row({ day: '2026-09-02', available_secs: 6 * H, utilised_secs: 0, patient_appts: 0 }),
            row({ practitioner_id: 'p2', day: '2026-09-02', available_secs: 5 * H, utilised_secs: 0, patient_appts: 0 }),
        ], error: null });
        const r = await practitionerUtilisationService.overview(ORG, span({ until: '2026-09-02' }));
        expect(r.excluded.blockOnlyDays).toBe(2);
        expect(r.excluded.blockOnlyHours).toBe(11);
        expect(r.excluded.practitioners).toBe(2);
    });

    it('leaves the grid cell empty rather than zero for those days', async () => {
        supaRec.rpcProvider = () => ({ data: [
            row({ day: '2026-09-01', patient_appts: 4 }),
            row({ day: '2026-09-02', utilised_secs: 0, patient_appts: 0 }),
        ], error: null });
        const r = await practitionerUtilisationService.overview(ORG, span({ until: '2026-09-02' }));
        const p = r.practitioners.find((x) => x.practitionerId === 'p1');
        expect(p.days.map((d) => d.day)).toEqual(['2026-09-01']);
    });
});

describe('totals are a ratio of sums', () => {
    // DECISION 2. The mean of daily percentages flatters short days: a
    // 45-minute list fully booked scores 100% and counts as much as a nine-hour
    // list at 60%.
    it('does not average the daily percentages', async () => {
        supaRec.rpcProvider = () => ({ data: [
            // 100% over three quarters of an hour.
            row({ day: '2026-09-01', available_secs: 0.75 * H, utilised_secs: 0.75 * H, patient_appts: 1 }),
            // 25% over nine hours.
            row({ day: '2026-09-02', available_secs: 9 * H, utilised_secs: 2.25 * H, patient_appts: 3 }),
        ], error: null });
        const r = await practitionerUtilisationService.overview(ORG, span({ until: '2026-09-02' }));
        // Ratio of sums: 3h of 9.75h = 30.8%. The mean of ratios would be 62.5%.
        expect(r.totals.utilisationPct).toBe(30.8);
        expect(r.totals.utilisationPct).not.toBe(62.5);
    });

    it('applies the same rule to each practitioner row', async () => {
        supaRec.rpcProvider = () => ({ data: [
            row({ day: '2026-09-01', available_secs: 1 * H, utilised_secs: 1 * H, patient_appts: 1 }),
            row({ day: '2026-09-02', available_secs: 9 * H, utilised_secs: 1 * H, patient_appts: 1 }),
        ], error: null });
        const r = await practitionerUtilisationService.overview(ORG, span({ until: '2026-09-02' }));
        expect(r.practitioners[0].utilisationPct).toBe(20);   // 2h of 10h
    });
});

describe('money', () => {
    // Null is not zero, throughout. A practitioner with no invoicing has no
    // rate; "£0.00 per hour" is a figure nobody recorded.
    it('reports no rate at all when nothing was invoiced', async () => {
        supaRec.rpcProvider = () => ({ data: [row({ revenue_pence: null })], error: null });
        const r = await practitionerUtilisationService.overview(ORG, span({ until: '2026-09-01' }));
        expect(r.totals.revenuePence).toBeNull();
        expect(r.totals.revenuePerUtilisedHourPence).toBeNull();
        expect(r.totals.unusedHoursValuePence).toBeNull();
        expect(r.practitioners[0].revenuePerUtilisedHourPence).toBeNull();
    });

    it('prices the unused hours at the rate actually achieved', async () => {
        supaRec.rpcProvider = () => ({ data: [
            row({ available_secs: 10 * H, utilised_secs: 4 * H, patient_appts: 4, revenue_pence: 80_000 }),
        ], error: null });
        const r = await practitionerUtilisationService.overview(ORG, span({ until: '2026-09-01' }));
        expect(r.totals.revenuePerUtilisedHourPence).toBe(20_000);  // £800 over 4h
        expect(r.totals.unusedHours).toBe(6);
        expect(r.totals.unusedHoursValuePence).toBe(120_000);       // 6h at £200
    });
});

describe('edge cases', () => {
    it('reports null, not 0%, for a window with nothing in it', async () => {
        supaRec.rpcProvider = () => ({ data: [], error: null });
        const r = await practitionerUtilisationService.overview(ORG, span({ until: '2026-09-07' }));
        expect(r.totals.utilisationPct).toBeNull();
        expect(r.days).toEqual([]);
        expect(r.practitioners).toEqual([]);
    });

    // Overlapping or overrunning appointments are real, and Dentally's own
    // chart carries a ">100%" band. Clamping would hide double-booking.
    it('lets utilisation exceed 100%', async () => {
        supaRec.rpcProvider = () => ({ data: [
            row({ available_secs: 4 * H, utilised_secs: 5 * H, patient_appts: 6 }),
        ], error: null });
        const r = await practitionerUtilisationService.overview(ORG, span({ until: '2026-09-01' }));
        expect(r.totals.utilisationPct).toBe(125);
    });

    it('names a practitioner the associates table does not know', async () => {
        supaRec.rpcProvider = () => ({ data: [
            row({ practitioner_name: 'Practitioner 198723' }),
        ], error: null });
        const r = await practitionerUtilisationService.overview(ORG, span({ until: '2026-09-01' }));
        expect(r.practitioners[0].practitionerName).toBe('Practitioner 198723');
    });
});

describe('the denominator basis', () => {
    // THE DIARY SPAN IS WIDE. A non-clinical block at either end of the day
    // stretches it: measured on one practitioner, a 60-minute block at 08:30
    // and a "No more Bookings" at 17:15 turned a 4h15 clinical day into a 9h30
    // span, and the cell read 45% where Dentally read 142%.
    it('divides by the clinical window by default, and by the span when asked', async () => {
        supaRec.rpcProvider = () => ({ data: [
            row({ available_secs: 10 * H, clinical_secs: 5 * H, utilised_secs: 4 * H, patient_appts: 4 }),
        ], error: null });

        const clinical = await practitionerUtilisationService.overview(ORG, {
            since: '2026-09-01', until: '2026-09-01',
        });
        expect(clinical.basis).toBe('clinical');
        expect(clinical.totals.utilisationPct).toBe(80);        // 4h of 5h
        expect(clinical.totals.availableHours).toBe(5);

        const bySpan = await practitionerUtilisationService.overview(ORG, {
            since: '2026-09-01', until: '2026-09-01', basis: 'span',
        });
        expect(bySpan.basis).toBe('span');
        expect(bySpan.totals.utilisationPct).toBe(40);          // 4h of 10h
        expect(bySpan.totals.availableHours).toBe(10);
    });

    // The chosen basis must reach EVERY figure, not just the headline —
    // a card and the grid beneath it dividing by different denominators is
    // exactly the kind of quiet disagreement this page exists to avoid.
    it('applies the same basis to the per-practitioner rows and the day series', async () => {
        supaRec.rpcProvider = () => ({ data: [
            row({ available_secs: 10 * H, clinical_secs: 5 * H, utilised_secs: 4 * H, patient_appts: 4 }),
        ], error: null });
        const r = await practitionerUtilisationService.overview(ORG, {
            since: '2026-09-01', until: '2026-09-01',
        });
        expect(r.practitioners[0].utilisationPct).toBe(80);
        expect(r.practitioners[0].availableHours).toBe(5);
        expect(r.days[0].utilisationPct).toBe(80);
        expect(r.days[0].availableHours).toBe(5);
    });

    // Back-to-back appointments make the clinical window equal the utilised
    // time, which is a real 100% and not an error. Measured: practitioner
    // 201099 on 21 September, 255 minutes of both.
    it('reads 100% when the clinical window is fully booked', async () => {
        supaRec.rpcProvider = () => ({ data: [
            row({ available_secs: 9.5 * H, clinical_secs: 4.25 * H, utilised_secs: 4.25 * H, patient_appts: 5 }),
        ], error: null });
        const r = await practitionerUtilisationService.overview(ORG, {
            since: '2026-09-01', until: '2026-09-01',
        });
        expect(r.totals.utilisationPct).toBe(100);
    });
});

describe('multi-tenancy', () => {
    it('asks SQL for the caller organisation and nothing else', async () => {
        supaRec.rpcProvider = () => ({ data: [row({})], error: null });
        await practitionerUtilisationService.overview(ORG, span({
            until: '2026-09-07', practiceId: null,
        }));
        expect(supaRec.rpcCalls).toHaveLength(1);
        expect(supaRec.rpcCalls[0].fn).toBe('practitioner_utilisation_daily');
        expect(supaRec.rpcCalls[0].params.p_org).toBe(ORG);
        expect(JSON.stringify(supaRec.rpcCalls[0].params)).not.toContain(OTHER);
    });

    // PRACTICE-WISE means the filter reaches SQL, so the cards, the chart and
    // the grid all narrow together. A filter applied only to the grid would
    // leave the headline describing practices no longer on screen — the same
    // defect as a date filter that misses its aggregate.
    it('carries the practice into every figure, not just the grid', async () => {
        supaRec.rpcProvider = () => ({ data: [row({ practice_id: 'prac-1' })], error: null });
        const r = await practitionerUtilisationService.overview(ORG, span({
            until: '2026-09-01', practiceId: 'prac-1',
        }));
        expect(supaRec.rpcCalls[0].params.p_practice).toBe('prac-1');
        // …and the practice travels back out, per day, so a hover card can name
        // the site a clinician was actually at.
        expect(r.practitioners[0].days[0].practiceId).toBe('prac-1');
        expect(r.practitioners[0].practiceId).toBe('prac-1');
    });

    // A practitioner who moved sites mid-window gets the one they worked most,
    // as a row label only — the per-day value stays exact.
    it('labels a row with the site worked most, keeping each day exact', async () => {
        supaRec.rpcProvider = () => ({ data: [
            row({ day: '2026-09-01', practice_id: 'prac-a' }),
            row({ day: '2026-09-02', practice_id: 'prac-b' }),
            row({ day: '2026-09-03', practice_id: 'prac-b' }),
        ], error: null });
        const r = await practitionerUtilisationService.overview(ORG, span({ until: '2026-09-03' }));
        expect(r.practitioners[0].practiceId).toBe('prac-b');
        expect(r.practitioners[0].days.map((d) => d.practiceId)).toEqual(['prac-a', 'prac-b', 'prac-b']);
    });

    it('passes the window and practice through untouched', async () => {
        supaRec.rpcProvider = () => ({ data: [], error: null });
        await practitionerUtilisationService.overview(ORG, span({
            since: '2026-08-01', until: '2026-08-31', practiceId: 'prac-1',
        }));
        const { params } = supaRec.rpcCalls[0];
        expect(params.p_since).toBe('2026-08-01');
        expect(params.p_until).toBe('2026-08-31');
        expect(params.p_practice).toBe('prac-1');
    });
});
