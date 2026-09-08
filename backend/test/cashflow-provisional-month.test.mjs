// ============================================================================
// THE CURRENT MONTH'S COSTS ARE A STUB, AND NET CASH AGAINST IT IS A LIE.
//
// Receipts arrive daily. Costs post in batches, and most of them late —
// payroll, rent, lab bills. Measured on live data on 9 September 2026, the
// accounting feed held FOURTEEN cost accounts for September against 65-72 in
// each of the four months before it, and £13,448.53 of cost against £298k-£428k
// in those months. Beside that stub sat nine days of takings, which accrue
// steadily and were complete for the days elapsed.
//
// The page rendered "Net cash this month +£62,518" from those two numbers, in
// confident green, under a card headed as though it described the month's
// trading. By the 20th of a month it reads wildly positive and then collapses
// when the costs land.
//
// A month cannot be complete before it has ended, so this needs no heuristic
// and no threshold. The CURRENT calendar month is provisional on the cost side,
// says so, and the UI reads "so far".
// ============================================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const svc = (await import('../src/services/analytics.service.js')).analyticsService;
const ORG = 'org-provisional';

const now = () => new Date(2026, 8, 9); // 9 September 2026

/** One month of QuickBooks cash-basis rows: revenue plus a single cost bucket. */
const monthRows = (period, costPence) => ([
  { period, dental_bucket: 'revenue', amount_pence: 10_000_000, source: 'quickbooks', practice_id: null, accounting_method: 'cash' },
  { period, dental_bucket: 'staff', amount_pence: costPence, source: 'quickbooks', practice_id: null, accounting_method: 'cash' },
]);

beforeEach(() => {
    supaRec.resultProvider = () => ({ data: [], error: null });
    supaRec.rpcProvider = () => ({ data: [], error: null });
});

describe('cashflowOutlook — the current month is provisional on the cost side', () => {
    const withCosts = (q) =>
        q.table === 'monthly_financials'
            ? { data: [...monthRows('2026-08', 29_880_837), ...monthRows('2026-09', 1_344_853)], error: null }
            : { data: [], error: null };
    const receipts = (fn) =>
        fn === 'settled_receipts_by_day'
            ? {
                data: [
                    { day: '2026-08-15', pence: 30_000_000 },
                    { day: '2026-09-05', pence: 7_718_460 },
                ],
                error: null,
            }
            : { data: [], error: null };

    it('flags the current month, and only the current month', async () => {
        supaRec.resultProvider = withCosts;
        supaRec.rpcProvider = receipts;
        const r = await svc.cashflowOutlook(ORG, { months: 4, forward: 0, now });
        expect(r.months.find((m) => m.month === '2026-09').costsPartial).toBe(true);
        expect(r.months.find((m) => m.month === '2026-08').costsPartial).toBe(false);
    });

    it('a month with no cost feed is not "partial" — it is absent', async () => {
        // Partial means "some of it has posted". Nothing posted at all is a
        // different state and must not borrow this flag, or an unconnected
        // tenant would be told its costs are merely still arriving.
        supaRec.rpcProvider = receipts;
        const r = await svc.cashflowOutlook(ORG, { months: 4, forward: 0, now });
        expect(r.months.find((m) => m.month === '2026-09').costsPartial).toBe(false);
        expect(r.costsAvailable).toBe(false);
    });

    it('an ANCHORED month reports its opening as reconstructed, even alone', async () => {
        // The closing balance is anchored to TODAY's real bank figure and the
        // opening is derived backwards from it. With a single month on screen
        // the old flag was false, so a derived opening (£720,904 = £783,422
        // less the month's net) was presented as an observed one.
        supaRec.resultProvider = (q) =>
            q.table === 'bank_accounts'
                ? { data: [{ balance_pence: 78_342_222, last_synced_at: '2026-09-09T00:00:00Z' }], error: null }
                : { data: [], error: null };
        supaRec.rpcProvider = receipts;
        const r = await svc.cashflowOutlook(ORG, {
            months: 4, forward: 0, now, from: '2026-09-01', to: '2026-09-30',
        });
        expect(r.months).toHaveLength(1);
        expect(r.balancesReconstructed).toBe(true);
    });

    it('the trend carries the flag too, so the chart can mark its last point', async () => {
        supaRec.resultProvider = withCosts;
        supaRec.rpcProvider = receipts;
        const r = await svc.cashflowOutlook(ORG, {
            months: 4, forward: 0, now, from: '2026-09-01', to: '2026-09-30',
        });
        expect(r.trend.at(-1).month).toBe('2026-09');
        expect(r.trend.at(-1).costsPartial).toBe(true);
    });
});
