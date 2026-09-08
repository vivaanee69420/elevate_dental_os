// ============================================================================
// The rota basis — Dentally's own denominator, and the three ways it lies if
// you take it literally.
//
// The rota reconciles exactly where it matters: practitioner 201099 on 21
// September reads 4h15 utilised against a rostered 3h00, which is the 142%
// Dentally itself prints, where the clinical basis read 45%. That part is
// arithmetic and needs no defending.
//
// What needs pinning is everything around it, because each of these produces a
// plausible-looking number that is wrong:
//
//   1. The rota rosters EVERY member of staff. Twenty of this group's fifty-
//      five rostered people treat no patient at all, each carrying about 235
//      hours a month. Divide by all of them and August reads 16.8% instead of
//      42.7%.
//   2. A rostered day with NO patients is the unused capacity the report
//      exists to find. The other two bases drop such a day (there is no window
//      to measure); the rota basis must keep it, or utilisation is inflated.
//   3. A day off and a day we have no rota for are different facts. Both
//      arrive as "not rostered" and both must stay out of the ratio, but they
//      are reported separately — and neither may be read as a zero-length
//      available window, which anything dividing by it would turn into
//      infinity.
// ============================================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';
import { practitionerUtilisationService } from '../src/services/practitioner-utilisation.service.js';
import { rotaRow, rotaDay, ROTA_MAX_PAGES, ROTA_BACKFILL_DAYS } from '../src/lib/integrations/dentally-sync.js';

const ORG = '11111111-1111-1111-1111-111111111111';
const H = 3600;

/** A practitioner-day as the RPC returns it, rostered unless told otherwise. */
const row = (o) => ({
    practitioner_id: 'p1', practitioner_name: 'A Clinician', practice_id: null,
    day: '2026-09-01', available_secs: 8 * H, clinical_secs: 4 * H,
    utilised_secs: 2 * H, rota_secs: 8 * H, rota_break_secs: 0, rostered: true,
    patient_appts: 2, block_appts: 0, revenue_pence: null, ...o,
});
/** Rostered off: NULL times, never zero. */
const off = (o) => row({ rota_secs: null, rota_break_secs: null, rostered: false, ...o });
/** No rota row at all for that practitioner-day. */
const noRota = (o) => row({ rota_secs: null, rota_break_secs: null, rostered: null, ...o });

const win = (o = {}) => ({ since: '2026-09-01', until: '2026-09-30', basis: 'rota', ...o });

beforeEach(() => { supaRec.rpcCalls = []; supaRec.rpcProvider = null; });

describe('the rota reproduces Dentally, which the diary could not', () => {
    // The live case, to the minute. 4h15 of patient time inside a 3h00
    // rostered window is 141.7%, which Dentally displays as its rounded 142%.
    // Over 100% because the day genuinely overran, not because anything is
    // broken — Dentally's own chart carries a ">100%" band for exactly this.
    // We keep the tenth: rounding for display is the screen's business, and a
    // figure rounded twice drifts.
    it('reads 141.7% where Dentally displays 142%', async () => {
        supaRec.rpcProvider = () => ({ data: [
            row({ utilised_secs: 4.25 * H, clinical_secs: 4.25 * H, available_secs: 9.5 * H, rota_secs: 3 * H }),
        ], error: null });
        const r = await practitionerUtilisationService.overview(ORG, win());
        expect(r.totals.utilisationPct).toBe(141.7);
        expect(Math.round(r.totals.utilisationPct)).toBe(142);
        expect(r.totals.availableHours).toBe(3);
    });

    // The same row on the old basis, so the difference is the denominator and
    // nothing else. This is the comparison that found the bug.
    it('the clinical basis reads 100% and the span 44.7% on the same row', async () => {
        const data = [row({ utilised_secs: 4.25 * H, clinical_secs: 4.25 * H, available_secs: 9.5 * H, rota_secs: 3 * H })];
        supaRec.rpcProvider = () => ({ data, error: null });
        expect((await practitionerUtilisationService.overview(ORG, win({ basis: 'clinical' }))).totals.utilisationPct).toBe(100);
        supaRec.rpcProvider = () => ({ data, error: null });
        expect((await practitionerUtilisationService.overview(ORG, win({ basis: 'span' }))).totals.utilisationPct).toBe(44.7);
    });
});

describe('who belongs in the denominator', () => {
    // FAILURE 1. The receptionist rostered nine hours a day who never treats
    // anyone. Including them is what turns 42.7% into 16.8%.
    it('excludes a rostered person who treated nobody in the window', async () => {
        supaRec.rpcProvider = () => ({ data: [
            row({ practitioner_id: 'clinician', utilised_secs: 4 * H, rota_secs: 8 * H, patient_appts: 4 }),
            row({ practitioner_id: 'reception', utilised_secs: 0, rota_secs: 8 * H, patient_appts: 0, block_appts: 2 }),
        ], error: null });
        const r = await practitionerUtilisationService.overview(ORG, win());
        expect(r.totals.utilisationPct).toBe(50);        // 4h of 8h, not 4h of 16h
        expect(r.totals.practitioners).toBe(1);
        expect(r.excluded.practitioners).toBe(1);
    });

    // …and the rule is over the WHOLE WINDOW, not the day. A clinician who
    // treated patients on Monday is still a clinician on Tuesday.
    it('keeps a clinician’s empty day once they have treated anyone in the window', async () => {
        supaRec.rpcProvider = () => ({ data: [
            row({ day: '2026-09-01', utilised_secs: 4 * H, rota_secs: 8 * H, patient_appts: 4 }),
            // FAILURE 2. Rostered, nobody booked. This is the finding, not noise.
            row({ day: '2026-09-02', utilised_secs: 0, rota_secs: 8 * H, patient_appts: 0 }),
        ], error: null });
        const r = await practitionerUtilisationService.overview(ORG, win());
        expect(r.totals.utilisationPct).toBe(25);        // 4h of 16h
        expect(r.totals.daysWorked).toBe(2);
        expect(r.totals.unusedHours).toBe(12);
    });

    // The contrast that makes decision 2 explicit: on the clinical basis the
    // same empty day has no measurable window and is set aside, so the same
    // data reads 100%. Both are right for their own basis; silently sharing
    // one rule would make one of them wrong.
    it('the clinical basis drops that empty day, the rota basis does not', async () => {
        supaRec.rpcProvider = () => ({ data: [
            row({ day: '2026-09-01', utilised_secs: 4 * H, clinical_secs: 4 * H, patient_appts: 4 }),
            row({ day: '2026-09-02', utilised_secs: 0, clinical_secs: 0, patient_appts: 0 }),
        ], error: null });
        const r = await practitionerUtilisationService.overview(ORG, win({ basis: 'clinical' }));
        expect(r.totals.utilisationPct).toBe(100);
        expect(r.totals.daysWorked).toBe(1);
    });
});

describe('days with no rostered window', () => {
    // FAILURE 3a. Patient time on a rostered day off. Real work, no
    // denominator — so it must not enter the ratio, and must not vanish.
    it('reports work done on a rostered day off instead of counting it', async () => {
        supaRec.rpcProvider = () => ({ data: [
            row({ day: '2026-09-01', utilised_secs: 4 * H, rota_secs: 8 * H, patient_appts: 4 }),
            off({ day: '2026-09-05', utilised_secs: 2 * H, patient_appts: 2 }),
        ], error: null });
        const r = await practitionerUtilisationService.overview(ORG, win());
        expect(r.totals.utilisationPct).toBe(50);         // 4h of 8h — the Saturday is not in it
        expect(r.excluded.offRotaDays).toBe(1);
        expect(r.excluded.offRotaUtilisedHours).toBe(2);
    });

    // FAILURE 3b. Distinct from the above, and reported distinctly: "we hold no
    // rota for this person" is not "the practice gave them the day off".
    it('keeps no-rota days separate from rostered days off', async () => {
        supaRec.rpcProvider = () => ({ data: [
            row({ day: '2026-09-01', utilised_secs: 4 * H, rota_secs: 8 * H, patient_appts: 4 }),
            off({ day: '2026-09-05', utilised_secs: 1 * H, patient_appts: 1 }),
            noRota({ day: '2026-09-06', utilised_secs: 3 * H, patient_appts: 3 }),
        ], error: null });
        const r = await practitionerUtilisationService.overview(ORG, win());
        expect(r.excluded.offRotaDays).toBe(1);
        expect(r.excluded.offRotaUtilisedHours).toBe(1);
        expect(r.excluded.noRotaDays).toBe(1);
        expect(r.excluded.noRotaUtilisedHours).toBe(3);
        expect(r.totals.availableHours).toBe(8);          // neither added a window
    });

    // The whole point of null-not-zero. If an unrostered day contributed a
    // zero-length window, any per-day percentage would divide by it.
    it('never yields a day whose available time is zero but whose ratio is not null', async () => {
        supaRec.rpcProvider = () => ({ data: [
            row({ day: '2026-09-01', utilised_secs: 4 * H, rota_secs: 8 * H, patient_appts: 4 }),
            off({ day: '2026-09-05', utilised_secs: 2 * H, patient_appts: 2 }),
        ], error: null });
        const r = await practitionerUtilisationService.overview(ORG, win());
        for (const d of r.days) {
            if (d.availableHours === 0) expect(d.utilisationPct).toBeNull();
            expect(Number.isFinite(d.utilisationPct ?? 0)).toBe(true);
        }
    });

    // A tenant whose practice has no Rota feature: every row comes back with
    // rostered = null. The answer is "we cannot tell you", never a confident 0%
    // and never a 100% off an empty denominator.
    it('returns a null percentage when the org has no rota at all', async () => {
        supaRec.rpcProvider = () => ({ data: [
            noRota({ day: '2026-09-01', utilised_secs: 4 * H, patient_appts: 4 }),
            noRota({ day: '2026-09-02', utilised_secs: 3 * H, patient_appts: 3 }),
        ], error: null });
        const r = await practitionerUtilisationService.overview(ORG, win());
        expect(r.totals.utilisationPct).toBeNull();
        expect(r.totals.availableHours).toBe(0);
        expect(r.excluded.noRotaDays).toBe(2);
    });
});

describe('exact seconds travel beside the rounded hours', () => {
    // THE BUG THIS PINS. The grid tooltip prints hours and minutes. It used to
    // derive them from the 1-decimal hour the API publishes, so a real 255
    // minutes (4h 15m - exactly what Dentally shows for practitioner 201099 on
    // 21 September) became 4.3 hours and rendered as "4h 18m", with the
    // bookable line inheriting the same three invented minutes. The fix is
    // that anything rendered finer than the rounding reads the SECONDS, so
    // they have to be here and they have to be exact.
    it('publishes utilised seconds that round-trip to the true minutes', async () => {
        supaRec.rpcProvider = () => ({ data: [
            row({ utilised_secs: 255 * 60, rota_secs: 3 * H, clinical_secs: 255 * 60, available_secs: 9.5 * H }),
        ], error: null });
        const r = await practitionerUtilisationService.overview(ORG, win());
        const day = r.practitioners[0].days[0];
        expect(day.utilisedSecs).toBe(255 * 60);
        expect(day.availableSecs).toBe(3 * H);
        // The rounded hour is still published, and is still lossy - which is
        // exactly why the minutes must not be taken from it.
        expect(day.utilisedHours).toBe(4.3);
        expect(Math.round(day.utilisedSecs / 60)).toBe(255);          // 4h 15m
        expect(Math.round(day.utilisedHours * 60)).toBe(258);         // 4h 18m, the bug
    });

    it('carries seconds on the practitioner total and the group day too', async () => {
        supaRec.rpcProvider = () => ({ data: [
            row({ day: '2026-09-01', utilised_secs: 255 * 60, rota_secs: 3 * H }),
            row({ day: '2026-09-02', utilised_secs: 45 * 60, rota_secs: 1 * H }),
        ], error: null });
        const r = await practitionerUtilisationService.overview(ORG, win());
        expect(r.practitioners[0].utilisedSecs).toBe(300 * 60);
        expect(r.practitioners[0].availableSecs).toBe(4 * H);
        expect(r.days.reduce((a, d) => a + d.utilisedSecs, 0)).toBe(300 * 60);
    });
});

describe('practitioners who saw nobody are listed, never counted', () => {
    // Dentally's picker offers everyone assigned to the site. Ours listed only
    // people who treated somebody, so Nadia Reinolds' Rochester identity - 0
    // patients across eleven weeks, blocks only - was missing from the menu
    // entirely. "Rostered and saw nobody" is the finding, and a menu that
    // omits them hides it, exactly as dropping the empty weeks did.
    it('returns them separately so the picker can offer them', async () => {
        supaRec.rpcProvider = () => ({ data: [
            row({ practitioner_id: 'clinician', practitioner_name: 'A', patient_appts: 4, utilised_secs: 4 * H, rota_secs: 8 * H }),
            row({ practitioner_id: 'blocks', practitioner_name: 'B', patient_appts: 0, block_appts: 3, utilised_secs: 0, rota_secs: 8 * H }),
        ], error: null });
        const r = await practitionerUtilisationService.overview(ORG, win());
        expect(r.practitioners.map((p) => p.practitionerId)).toEqual(['clinician']);
        expect(r.otherPractitioners.map((p) => p.practitionerId)).toEqual(['blocks']);
    });

    // …and they stay out of every total. Counting them is what collapses the
    // group figure from 42.7% to 16.8%.
    it('keeps them out of the totals and the daily series', async () => {
        supaRec.rpcProvider = () => ({ data: [
            row({ practitioner_id: 'clinician', patient_appts: 4, utilised_secs: 4 * H, rota_secs: 8 * H }),
            row({ practitioner_id: 'blocks', patient_appts: 0, block_appts: 3, utilised_secs: 0, rota_secs: 8 * H }),
        ], error: null });
        const r = await practitionerUtilisationService.overview(ORG, win());
        expect(r.totals.utilisationPct).toBe(50);        // 4h of 8h, not of 16h
        expect(r.totals.practitioners).toBe(1);
        expect(r.days.reduce((a, d) => a + d.availableHours, 0)).toBe(8);
    });

    // Their days carry a REAL zero, not a null: they were in the diary and saw
    // nobody, which is different from having no window to measure.
    it('gives them a day series that reads zero rather than unknown', async () => {
        supaRec.rpcProvider = () => ({ data: [
            row({ practitioner_id: 'clinician', patient_appts: 4, utilised_secs: 4 * H, rota_secs: 8 * H }),
            row({ practitioner_id: 'blocks', patient_appts: 0, block_appts: 3, utilised_secs: 0, rota_secs: 8 * H }),
        ], error: null });
        const r = await practitionerUtilisationService.overview(ORG, win());
        const day = r.otherPractitioners[0].days[0];
        expect(day.utilisedSecs).toBe(0);
        expect(day.availableSecs).toBe(8 * H);
        expect(day.utilisationPct).toBe(0);
    });
});

describe('breaks', () => {
    // The headline is GROSS of breaks, because that is what reconciled against
    // Dentally. Net is published rather than assumed, so nobody has to guess a
    // lunch length to reproduce it.
    it('divides by the rostered window and states the break hours separately', async () => {
        supaRec.rpcProvider = () => ({ data: [
            row({ utilised_secs: 4 * H, rota_secs: 8 * H, rota_break_secs: 1 * H, patient_appts: 4 }),
        ], error: null });
        const r = await practitionerUtilisationService.overview(ORG, win());
        expect(r.totals.utilisationPct).toBe(50);        // 4h of 8h, not of 7h
        expect(r.excluded.rotaBreakHours).toBe(1);
    });
});

describe('mapping one Dentally rota row', () => {
    const P = '11111111-1111-1111-1111-111111111111';

    it('sums the named breaks into seconds', () => {
        const r = rotaRow(ORG, {
            id: 'abc', practitioner_id: 201099, day: '2026-09-01', unavailable: false,
            start_time: '2026-09-01T09:30:00.000+01:00',
            end_time: '2026-09-01T17:30:00.000+01:00',
            breaks: [
                { name: 'Lunch', start_time: '2026-09-01T14:00:00.000+01:00', end_time: '2026-09-01T15:00:00.000+01:00' },
                { name: 'Tea', start_time: '2026-09-01T16:00:00.000+01:00', end_time: '2026-09-01T16:15:00.000+01:00' },
            ],
        }, P, 'site-1');
        expect(r.break_secs).toBe(75 * 60);
        expect(r.unavailable).toBe(false);
        expect(r.practice_id).toBe(P);
        // Dentally's ids are numbers; appointments.pms_practitioner_id is text.
        // The join is on that column, so the type must not drift.
        expect(r.pms_practitioner_id).toBe('201099');
    });

    // A day off arrives as unavailable with null times, and is STORED. Dropping
    // it would make "the practice rostered them off" indistinguishable from
    // "we never fetched their rota".
    it('keeps a rostered day off as a row with no window', () => {
        const r = rotaRow(ORG, {
            id: 'def', practitioner_id: 1, day: '2026-09-06',
            unavailable: true, start_time: null, end_time: null, breaks: [],
        }, null, null);
        expect(r.unavailable).toBe(true);
        expect(r.starts_at).toBeNull();
        expect(r.ends_at).toBeNull();
        expect(r.break_secs).toBe(0);
        expect(r.practice_id).toBeNull();
    });

    // Defensive: a half-open session would violate the table's own CHECK, so it
    // is normalised to "off" here rather than rejected row-by-row at insert.
    it('treats a row missing one end as not rostered', () => {
        const r = rotaRow(ORG, {
            id: 'ghi', practitioner_id: 2, day: '2026-09-07', unavailable: false,
            start_time: '2026-09-07T09:00:00.000+01:00', end_time: null, breaks: [],
        }, null, null);
        expect(r.unavailable).toBe(true);
        expect(r.starts_at).toBeNull();
    });

    it('drops a row with no practitioner or no day rather than writing a null key', () => {
        expect(rotaRow(ORG, { day: '2026-09-01' }, null, null)).toBeNull();
        expect(rotaRow(ORG, { practitioner_id: 3 }, null, null)).toBeNull();
    });

    // A practitioner_id of 0 is a legitimate id, not an absence. `!pid` would
    // have thrown it away.
    it('keeps practitioner id 0', () => {
        const r = rotaRow(ORG, { practitioner_id: 0, day: '2026-09-01', unavailable: true }, null, null);
        expect(r?.pms_practitioner_id).toBe('0');
    });
});

describe('the pull window', () => {
    // Reaches BACKWARDS. Utilisation is reported over months that have closed,
    // so a window starting today would give every past month no denominator.
    it('counts back from today at midday, so a DST shift cannot move the date', () => {
        // 26 October 2026 is the day after the British clocks go back.
        const now = new Date('2026-10-26T00:30:00Z');
        expect(rotaDay(0, now)).toBe('2026-10-26');
        expect(rotaDay(-1, now)).toBe('2026-10-25');
        expect(rotaDay(1, now)).toBe('2026-10-27');
    });

    it('crosses a month and a year boundary correctly', () => {
        expect(rotaDay(-1, new Date('2027-01-01T12:00:00Z'))).toBe('2026-12-31');
        expect(rotaDay(1, new Date('2026-02-28T12:00:00Z'))).toBe('2026-03-01');
    });

    // The page cap has to clear the BACKFILL, not the nightly window, and the
    // rota's volume is days x roster rather than days x activity: every
    // practitioner gets a row every day whether they worked or not. The shared
    // 100-page cap would have stopped a 400-day backfill a third of the way in
    // — while returning normally, so the run would have stamped itself
    // complete over a permanent hole.
    it('caps pages above what a full backfill needs', () => {
        const PER_PAGE = 100;
        // A large group: 460 days of window against a 100-strong roster.
        const worstCasePages = Math.ceil(((ROTA_BACKFILL_DAYS + 60) * 100) / PER_PAGE);
        expect(ROTA_MAX_PAGES).toBeGreaterThan(worstCasePages / 2);
        expect(ROTA_MAX_PAGES).toBeGreaterThan(253);   // this group's own measured backfill
    });
});
