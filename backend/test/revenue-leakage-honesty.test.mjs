// ============================================================================
// REVENUE LEAKAGE WAS REPORTING 77% OF TURNOVER AS RECOVERABLE.
//
// Traced pool by pool against live data, four separate faults:
//
// 1. THE PLANS POOL IS NOT MEASURING ACCEPTANCE. It computes
//    (presented - accepted) where "accepted" is treatment_plans.completed —
//    and Dentally sends no acceptance state at all, only completion. The
//    completed share of plan VALUE was 1.1%-6.5% in every one of the last
//    thirteen months, including months a year old, so this is not immaturity:
//    the flag is barely populated. "Unaccepted" therefore equalled essentially
//    the whole presented value, every window, for every tenant.
//
//    Live: September presented £203,905.97, "accepted" £3,072.80. The pool
//    took 30% of the £200,833.17 difference and annualised it to £733,041.06
//    — 93% of the page's headline, and a number that is really "30% of every
//    treatment plan raised", not money anyone has lost. Work in progress and
//    work scheduled for next month are both counted as leaked.
//
// 2. THE COLLECTIONS POOL IS STRUCTURALLY ALWAYS ZERO. It computes
//    revenue - cashCollected, but the service passes SETTLED RECEIPTS as both.
//    A figure subtracted from itself is zero for every org forever, which is
//    exactly what the page showed: "Uncollected / open balances £0.00" beside
//    real unpaid invoices in the same ledger.
//
// 3. MEASURED AND MODELLED POOLS WERE ADDED TOGETHER. Recall and lapsed are
//    flat shares of revenue — constants, not observations — and the footnote
//    said so, but the headline summed them with the measured ones and called
//    the total recoverable.
//
// 4. The headline percentage inherited all of the above.
//
// The pools stay (they are useful planning figures) but each now declares
// whether it is MEASURED or MODELLED, the headline is the measured total, and
// the plans line is named for what it actually counts.
// ============================================================================
import { describe, it, expect } from 'vitest';

const { calculateRevenueLeakage } = await import('../src/lib/formulas.js');

const BASE = {
    revenuePence: 4_287_659,
    presentedPlanPence: 20_390_597,
    acceptedPlanPence: 307_280,
    appointments: 1000,
    noShows: 20,
    cashCollectedPence: 4_287_659, // identical to revenue — see fault 2
    outstandingPence: 318_330,     // real unpaid invoice balance
};

describe('revenue leakage — every pool declares what it is', () => {
    it('labels each pool measured or modelled', () => {
        const r = calculateRevenueLeakage(BASE);
        expect(r.basisByPool.fta).toBe('measured');
        expect(r.basisByPool.collect).toBe('measured');
        // Flat shares of revenue, not observations of real recall or lapsed lists.
        expect(r.basisByPool.recall).toBe('modelled');
        expect(r.basisByPool.lapsed).toBe('modelled');
        // No acceptance signal exists in the feed, so this is an upper bound.
        expect(r.basisByPool.plans).toBe('modelled');
    });

    it('the headline total counts MEASURED pools only', () => {
        const r = calculateRevenueLeakage(BASE);
        expect(r.measuredTotalPence).toBe(r.pools.fta + r.pools.collect);
        expect(r.modelledTotalPence).toBe(r.pools.plans + r.pools.recall + r.pools.lapsed);
        // The old windowTotalPence stays for callers that want everything, but
        // it is no longer what the page leads with.
        expect(r.windowTotalPence).toBe(r.measuredTotalPence + r.modelledTotalPence);
    });

    it('uncollected uses the real outstanding balance, not revenue minus itself', () => {
        // revenue and cashCollected are the SAME settled-receipts figure, so the
        // old subtraction was zero for every organisation, always.
        const r = calculateRevenueLeakage(BASE);
        expect(r.pools.collect).toBeGreaterThan(0);
        expect(r.pools.collect).toBe(Math.round(318_330 * 0.7));
    });

    it('no outstanding figure → a zero collections pool, not a fabricated one', () => {
        const r = calculateRevenueLeakage({ ...BASE, outstandingPence: 0 });
        expect(r.pools.collect).toBe(0);
    });

    it('reports the plan completion rate so the reader can judge the plans pool', () => {
        // 307,280 / 20,390,597 = 1.5%. A rate this low across mature months
        // means the flag is not populated, not that nothing was accepted.
        const r = calculateRevenueLeakage(BASE);
        expect(r.planCompletionPct).toBeCloseTo(1.5, 1);
    });

    it('no plan value at all → no plans pool and no completion rate', () => {
        const r = calculateRevenueLeakage({ ...BASE, presentedPlanPence: 0, acceptedPlanPence: 0 });
        expect(r.pools.plans).toBe(0);
        expect(r.planCompletionPct).toBeNull();
    });

    it('FTA stays measured and unchanged — it was always real', () => {
        // 2% no-show rate on £4,287.659 of revenue at the 50% default.
        const r = calculateRevenueLeakage(BASE);
        expect(r.ftaRatePct).toBeCloseTo(2, 1);
        expect(r.pools.fta).toBe(Math.round(4_287_659 * 0.02 * 0.5));
    });
});
