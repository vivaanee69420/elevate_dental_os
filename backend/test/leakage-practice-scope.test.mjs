// ============================================================================
// THE PRACTICE FILTER ON REVENUE LEAKAGE DID NOTHING.
//
// The page sends `scope` (either 'all' or a practice uuid) on every request —
// windowParams puts it there — and the service has full practice handling: it
// narrows the revenue, appointment and invoice feeds, and deliberately zeroes
// the plans pool because treatment_plans carry no practice_id and so cannot be
// attributed honestly.
//
// The controller never read it. It parsed days, since, until and the five rate
// overrides, then called the service without practiceId — so the parameter
// defaulted to null and every practice pill returned the group figure. Picking
// Rochester showed the same £733,041.06 as All practices.
//
// This is worse than an inert control: the numbers move very slightly between
// pills (the window shifts by a second between requests), so it looks like it
// is filtering and simply finding almost identical figures.
// ============================================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const svc = (await import('../src/services/analytics.service.js')).analyticsService;

const ORG = 'org-leak-scope';
const PRACTICE = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const now = () => new Date(Date.UTC(2026, 8, 15));

/** Two practices, so a scoped read must return strictly less than the group. */
const REV_ROWS = [
    { practice_id: PRACTICE, pence: 1_000_000 },
    { practice_id: 'other-practice', pence: 3_000_000 },
];
const APPT_ROWS = [
    { practice_id: PRACTICE, total: 100, no_shows: 5 },
    { practice_id: 'other-practice', total: 400, no_shows: 40 },
];
const INV_ROWS = [
    { practice_id: PRACTICE, outstanding_pence: 200_000 },
    { practice_id: 'other-practice', outstanding_pence: 800_000 },
];

beforeEach(() => {
    supaRec.resultProvider = () => ({ data: [], error: null });
    supaRec.rpcProvider = (fn) => {
        if (fn === 'settled_revenue_by_practice') return { data: REV_ROWS, error: null };
        if (fn === 'appointments_rollup_by_practice') return { data: APPT_ROWS, error: null };
        if (fn === 'invoice_totals_by_practice') return { data: INV_ROWS, error: null };
        return { data: [], error: null };
    };
});

describe('revenue leakage — the practice filter actually filters', () => {
    it('a scoped read is strictly smaller than the group read', async () => {
        const group = await svc.revenueLeakage(ORG, { now, days: 30 });
        const scoped = await svc.revenueLeakage(ORG, { now, days: 30, practiceId: PRACTICE });
        expect(scoped.inputs.revenuePence).toBe(1_000_000);
        expect(group.inputs.revenuePence).toBe(4_000_000);
        expect(scoped.annualTotalPence).toBeLessThan(group.annualTotalPence);
    });

    it('the collections pool uses only that practice\'s unpaid invoices', async () => {
        const scoped = await svc.revenueLeakage(ORG, { now, days: 30, practiceId: PRACTICE });
        expect(scoped.inputs.outstandingPence).toBe(200_000);
    });

    it('appointments and no-shows narrow too, so the FTA rate is the practice\'s own', async () => {
        // Group: 45 no-shows of 500 = 9%. This practice: 5 of 100 = 5%.
        const group = await svc.revenueLeakage(ORG, { now, days: 30 });
        const scoped = await svc.revenueLeakage(ORG, { now, days: 30, practiceId: PRACTICE });
        expect(group.ftaRatePct).toBeCloseTo(9, 1);
        expect(scoped.ftaRatePct).toBeCloseTo(5, 1);
    });

    it('the plans pool is zero when scoped, because plans carry no practice', async () => {
        // treatment_plans has no practice_id. Showing the GROUP's open plans
        // under one practice's name would be a fabricated attribution, so the
        // pool is withheld instead.
        const scoped = await svc.revenueLeakage(ORG, { now, days: 30, practiceId: PRACTICE });
        expect(scoped.inputs.presentedPence).toBe(0);
        const plans = scoped.lines.find((l) => l.key === 'plans');
        expect(plans.annualPence).toBe(0);
    });
});
