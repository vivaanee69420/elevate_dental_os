// ============================================================================
// Business Hub — the period comparison behind every Dentally card.
//
// Only Takings ever carried a delta, and it named its comparison "prev period"
// through BST (see test/compare-window.test.mjs for that root cause). These
// pin the service half: that a prior-period figure is fetched for EVERY card
// the Dentally section shows, over the window `comparisonWindows` resolved —
// not a second, separately-derived one — and that the extra reads join the
// bounded pool rather than a raw Promise.all.
//
// The pool matters as much as the numbers. This endpoint already fires 16 heavy
// aggregates; adding five more prior-period reads to an unbounded Promise.all
// is exactly what pushed statements past the 8s statement_timeout before
// (memory: business-hub-16-way-fanout).
// ============================================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';
import { invalidate as invalidateGating } from '../src/lib/integration-gating.js';

const svc = (await import('../src/services/analytics.service.js')).analyticsService;

const ORG = 'org-compare';
// June 2026, wholly finished by the injected clock — so `previous` is the whole
// of May and every figure below is a like-for-like month against month.
const JUN = { since: '2026-05-31T23:00:00.000Z', until: '2026-06-30T23:00:00.000Z' };
const NOW = () => new Date('2026-07-15T09:00:00.000Z');

// Splits a call into current-window or previous-window by its p_since. Every
// prior read must land on 1 May London (2026-04-30T23:00Z); anything else means
// the service derived its own window instead of using the resolved one.
const isPrev = (params) => params?.p_since === '2026-04-30T23:00:00.000Z';

const practices = [{ id: 'p1', name: 'Alpha', chairs: 4 }, { id: 'p2', name: 'Beta', chairs: 2 }];

// Current window returns the first number, previous window the second.
const pair = (cur, prev, params) => (isPrev(params) ? prev : cur);

// Two practices, so a group total is visibly the sum of its parts and a
// practice-scoped figure is visibly NOT the group's. The two payment feeds are
// kept consistent with each other on purpose: settled_receipts_by_day is the
// group's own total and settled_revenue_by_practice splits that same money, so
// a fixture where they disagree would let a bug pick the wrong one and pass.
function rollups(fn, params) {
    switch (fn) {
        case 'treatment_revenue_matrix':
            return { data: [{ practice_id: 'p1', treatment_name: 'X', fee_pence: pair(200000, 100000, params), item_count: 1 }], error: null };
        case 'settled_receipts_by_day':
            return { data: [{ day: '2026-06-02', pence: pair(210000, 160000, params) }], error: null };
        case 'settled_revenue_by_practice':
            return { data: [
                { practice_id: 'p1', pence: pair(150000, 120000, params) },
                { practice_id: 'p2', pence: pair(60000, 40000, params) },
            ], error: null };
        case 'appointments_rollup_by_practice':
            return { data: [
                { practice_id: 'p1', total: pair(40, 25, params), completed: pair(30, 20, params), no_shows: pair(4, 5, params) },
                { practice_id: 'p2', total: pair(10, 8, params), completed: pair(9, 7, params), no_shows: pair(1, 2, params) },
            ], error: null };
        case 'treatments_closed_revenue_by_practice':
            return { data: [{ practice_id: 'p1', closed_value_pence: pair(90000, 60000, params), paid_value_pence: pair(45000, 40000, params) }], error: null };
        case 'treatments_completed_by_practice':
            return { data: [{ practice_id: 'p1', completed_count: pair(12, 8, params), value_pence: pair(70000, 50000, params) }], error: null };
        case 'org_new_patients_registered_by_practice':
            return { data: [{ practice_id: 'p1', new_patients: pair(20, 16, params) }], error: null };
        case 'treatment_accepted_aggregate':
            return { data: [{ accepted_count: pair(9, 6, params), accepted_value_pence: pair(30000, 20000, params) }], error: null };
        case 'treatment_accepted_by_practice':
            return { data: [{ practice_id: 'p1', accepted_count: pair(9, 6, params), accepted_value_pence: pair(30000, 20000, params) }], error: null };
        default:
            return { data: [], error: null };
    }
}

beforeEach(() => {
    svc.invalidateBusinessHub();
    invalidateGating(ORG);
    supaRec.resultProvider = (q) => (
        q.table === 'practices' ? { data: practices, error: null }
            : q.table === 'business_health' ? { data: { baseline: {} }, error: null }
                // Emergent connected, so the Treatments Accepted card is live
                // rather than the disconnected placeholder — it has a prior
                // figure to compare like every other card.
                : q.table === 'integrations' ? { data: [{ provider: 'emergent', status: 'active' }], error: null }
                    : { data: [], error: null }
    );
    supaRec.rpcProvider = rollups;
});

describe('businessHub — the comparison the cards are measured against', () => {
    it('names both windows by their dates instead of the string "prev period"', async () => {
        const res = await svc.businessHub(ORG, { ...JUN, now: NOW });

        expect(res.group.compare.current.label).toBe('Jun 2026');
        expect(res.group.compare.previous.label).toBe('May 2026');
        expect(res.group.compare.complete).toBe(true);
    });

    it('returns the previous window bounds, so the UI never re-derives them', async () => {
        const res = await svc.businessHub(ORG, { ...JUN, now: NOW });

        expect(res.group.compare.previous.since).toBe('2026-04-30T23:00:00.000Z');
        expect(res.group.compare.previous.until).toBe(JUN.since);
    });

    it('carries a prior figure for every Dentally card, not just Takings', async () => {
        const res = await svc.businessHub(ORG, { ...JUN, now: NOW });

        expect(res.group.compare.prev).toMatchObject({
            takingsPence: 160000,   // 120k Alpha + 40k Beta
            turnoverPence: 100000,
            treatmentsCompleted: 8,
            treatmentsAcceptedCount: 6,
            treatmentsClosedPence: 60000,
            treatmentsPaidPence: 40000,
            appointments: 33,       // 25 + 8
            noShowRate: 21.2,       // 7 of 33
            newPatients: 16,
        });
    });

    it('reads each prior figure from the same feed as its current-window twin', async () => {
        // Guards against a prior figure quietly coming from a different source
        // than the number it sits beside — the card would then compare two
        // different metrics and no percentage on it could be right.
        const res = await svc.businessHub(ORG, { ...JUN, now: NOW });
        const { group } = res;

        expect(group.takingsPence).toBe(210000);
        expect(group.treatmentsCompleted).toBe(12);
        expect(group.treatmentsAcceptedCount).toBe(9);
        expect(group.treatmentsClosedPence).toBe(90000);
        expect(group.treatmentsPaidPence).toBe(45000);
        expect(group.appointments).toBe(50);
        expect(group.newPatients).toBe(20);
    });

    it('reports a null prior no-show rate when the previous window had no appointments', async () => {
        // A rate with no denominator is unknowable, not 0% — the card must show
        // no comparison rather than a confident "no-shows were zero".
        supaRec.rpcProvider = (fn, params) => (
            fn === 'appointments_rollup_by_practice' && isPrev(params)
                ? { data: [], error: null }
                : rollups(fn, params)
        );
        const res = await svc.businessHub(ORG, { ...JUN, now: NOW });

        expect(res.group.compare.prev.noShowRate).toBeNull();
        expect(res.group.compare.prev.appointments).toBe(0);
    });

    it('clamps a running month and compares it against the same days of the month before', async () => {
        // The screenshot case: September selected on the 6th. Six days of data
        // must not be measured against a whole thirty-day window.
        const res = await svc.businessHub(ORG, {
            since: '2026-08-31T23:00:00.000Z', until: '2026-09-30T23:00:00.000Z',
            now: () => new Date('2026-09-06T13:20:00.000Z'),
        });

        expect(res.group.compare.complete).toBe(false);
        expect(res.group.compare.current.label).toBe('1–6 Sep 2026');
        expect(res.group.compare.previous.label).toBe('1–6 Aug 2026');
        expect(res.group.compare.previous.since).toBe('2026-07-31T23:00:00.000Z');
        expect(res.group.compare.previous.until).toBe('2026-08-06T23:00:00.000Z');
    });

    it('carries a prior figure per practice, so the comparison survives the practice filter', async () => {
        // The practice pills filter this payload CLIENT-side — the endpoint is
        // called once, group-wide — so a group-only prior figure would put
        // Rochester's current takings over the whole group's previous ones.
        // Every card would then show a comparison that is wrong by the size of
        // the group, and only while a practice is selected.
        const res = await svc.businessHub(ORG, { ...JUN, now: NOW });
        const byPractice = res.group.compare.prev.byPractice;

        expect(byPractice).toHaveLength(2);
        // toMatchObject, not toEqual: this row grows a field whenever a card gains
        // a comparison, and freezing the whole shape here would fail that change
        // in a file that is not about the new card.
        expect(byPractice.find((r) => r.practiceId === 'p1')).toMatchObject({
            practiceId: 'p1',
            takingsPence: 120000,
            treatmentsCompleted: 8,
            treatmentsAcceptedCount: 6,
            treatmentsClosedPence: 60000,
            treatmentsPaidPence: 40000,
            appointments: 25,
            noShowRate: 20,      // 5 of 25
            newPatients: 16,
        });
        // A practice with no accepted rows at all reports 0, not the group's 6.
        expect(byPractice.find((r) => r.practiceId === 'p2')?.treatmentsAcceptedCount).toBe(0);
        expect(byPractice.find((r) => r.practiceId === 'p2')?.noShowRate).toBe(25); // 2 of 8
    });

    it('still sends prevPeriodLabel, so a frontend deployed later does not print "undefined"', async () => {
        // Backend and frontend are separate Railway services and do not ship
        // atomically. The old card read `g.prevPeriodLabel` directly; removing
        // it rendered a live chip as "\u25b2 213.2% vs undefined" for every user on
        // the not-yet-updated bundle. A field two lines long is much cheaper
        // than a deploy-ordering constraint.
        const res = await svc.businessHub(ORG, { ...JUN, now: NOW });

        expect(res.group.prevPeriodLabel).toBe('May 2026');
        expect(res.group.prevPeriodLabel).toBe(res.group.compare.previous.label);
    });

    it('keeps every read inside the bounded pool', async () => {
        // Concurrency is the assertion, not the call count: this endpoint's
        // statement timeouts came from an unbounded fan-out, and prior-period
        // reads are the same shape of heavy aggregate as the current-period ones.
        let live = 0, peak = 0;
        supaRec.rpcProvider = (fn, params) => {
            live += 1; peak = Math.max(peak, live);
            // Released on the microtask after the fake client resolves.
            queueMicrotask(() => { live -= 1; });
            return rollups(fn, params);
        };
        await svc.businessHub(ORG, { ...JUN, now: NOW });

        expect(peak).toBeLessThanOrEqual(4);
    });
});
