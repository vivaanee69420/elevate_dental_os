// ============================================================================
// Analytics — dashboard-summary / revenue-series / practice-summary.
//
// Pure/derived logic is asserted deterministically (revenue-series via an
// injected clock). DB access runs the REAL repository against the fake
// Supabase client from test/setup.js, recording every .eq() so cross-org
// isolation is proven on the service-client path (RLS is bypassed there —
// the explicit organisation_id filter is the only app-layer tenant guard).
// ============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { supaRec } from './setup.js';
import { invalidate as invalidateGating } from '../src/lib/integration-gating.js';

const svc = (await import('../src/services/analytics.service.js'))
  .analyticsService;
const analyticsTest = (await import('../src/services/analytics.service.js'))
  .__test;
const repo = (await import('../src/repositories/analytics.repository.js'))
  .analyticsRepository;
const bhRepo = (await import('../src/repositories/business-health.repository.js'))
  .businessHealthRepository;

const ORG_A = 'org-aaaaaaaa';
const ORG_B = 'org-bbbbbbbb';
const orgFilter = (q) => q.eqs.find((e) => e.col === 'organisation_id');

// Helper: stub the settled_receipts_by_day RPC with [{day, pence}] rows.
const rpcReceipts = (rows = []) => (fn) =>
  fn === 'settled_receipts_by_day' ? { data: rows, error: null } : { data: null, error: { message: `rpc ${fn} not stubbed` } };

beforeEach(() => {
  supaRec.last = undefined;
  supaRec.resultProvider = () => ({ data: [], error: null });
  supaRec.rpcProvider = () => ({ data: [], error: null });
});

describe('revenueSeries — exact real monthly revenue (no projection)', () => {
  const now = () => new Date(2026, 4, 15); // May 2026

  it('12 month keys ending at the clock month; revenue from RPC, profit/cash 0', async () => {
    supaRec.resultProvider = () => ({ data: [], error: null });
    supaRec.rpcProvider = rpcReceipts([
      { day: '2026-05-03', pence: 7_000_000 },
      { day: '2025-06-10', pence: 2_000_000 },
    ]);
    const r = await svc.revenueSeries(ORG_A, { months: 12, now });
    expect(r.basis).toBe('revenue-only');
    expect(r.months).toHaveLength(12);
    expect(r.months[0].month).toBe('2025-06');
    expect(r.months[11].month).toBe('2026-05');
    expect(r.months[11].revenue).toBe(7_000_000);
    expect(r.months[0].revenue).toBe(2_000_000);
    expect(r.months.every((m) => m.profit === 0 && m.cash === 0)).toBe(true);
  });

  it('no payments → 12 real zero months (no error, no baseline)', async () => {
    supaRec.resultProvider = () => ({ data: [], error: null });
    supaRec.rpcProvider = rpcReceipts([]);
    const r = await svc.revenueSeries(ORG_A, { now });
    expect(r.months).toHaveLength(12);
    expect(r.months.every((m) => m.revenue === 0)).toBe(true);
  });
});

describe('financeSeries — exact real revenue, costs/profit real-or-zero', () => {
  const now = () => new Date(2026, 4, 15);

  it('no payments + no actuals → 12 real zero months (no error)', async () => {
    supaRec.resultProvider = () => ({ data: [], error: null });
    supaRec.rpcProvider = rpcReceipts([]);
    const r = await svc.financeSeries(ORG_A, { months: 12, now });
    expect(r.basis).toBe('revenue-only');
    expect(r.months).toHaveLength(12);
    expect(r.months.every((m) => m.revenue === 0)).toBe(true);
    expect(r.costsAvailable).toBe(false);
  });

  it('revenue = EXACT settled receipts per month (RPC); costs & profit 0 (no cost source)', async () => {
    supaRec.resultProvider = (q) => (q.table === 'monthly_financials' ? { data: [], error: null } : { data: { baseline: { revenue: 1_200_000, cost_staff: 18 } }, error: null });
    // RPC daily rows summing to £60,000 in May, £30,000 in April
    supaRec.rpcProvider = rpcReceipts([
      { day: '2026-05-02', pence: 4_000_000 },
      { day: '2026-05-20', pence: 2_000_000 },
      { day: '2026-04-10', pence: 3_000_000 },
    ]);
    const fs = await svc.financeSeries(ORG_A, { months: 12, now });
    const may = fs.months.find((m) => m.month === '2026-05');
    expect(may.revenue).toBe(6_000_000); // exact real, not baseline curve
    expect(may.staffCosts).toBe(0); // no cost source → 0, NOT a baseline estimate
    expect(may.profit).toBe(0); // unknown costs → profit 0
    expect(may.costsAvailable).toBe(false);
    expect(fs.months.find((m) => m.month === '2026-04').revenue).toBe(3_000_000);
    expect(fs.costsAvailable).toBe(false);
  });

  it('custom from/to range overrides the rolling window + bounds the RPC', async () => {
    supaRec.resultProvider = () => ({ data: [], error: null });
    supaRec.rpcProvider = rpcReceipts([{ day: '2026-02-15', pence: 1_000_000 }]);
    supaRec.rpcCalls = [];
    const fs = await svc.financeSeries(ORG_A, { now, from: '2026-01-01', to: '2026-03-31' });
    // exactly the 3 months in range, in order
    expect(fs.months.map((m) => m.month)).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(fs.months.find((m) => m.month === '2026-02').revenue).toBe(1_000_000);
    // RPC received both bounds (open-ended trailing window would pass p_until null)
    const call = supaRec.rpcCalls.find((c) => c.fn === 'settled_receipts_by_day');
    expect(typeof call.params.p_since).toBe('string');
    expect(call.params.p_until).not.toBeNull();
  });
});

describe('financeSeries — /profit data-source toggle', () => {
  const now = () => new Date(2026, 4, 15); // May 2026

  it('source=quickbooks → P&L built ONLY from QBO actuals (rev+costs), Dentally feed ignored', async () => {
    supaRec.resultProvider = (q) =>
      q.table === 'monthly_financials'
        ? {
            data: [
              { period: '2026-05', dental_bucket: 'revenue', amount_pence: 5_000_000, source: 'quickbooks', practice_id: null, integration_account_id: 'qbo-1' },
              { period: '2026-05', dental_bucket: 'staff', amount_pence: 1_000_000, source: 'quickbooks', practice_id: null, integration_account_id: 'qbo-1' },
            ],
            error: null,
          }
        : { data: [], error: null };
    // A settled-receipts feed exists but MUST NOT leak into the QuickBooks view.
    supaRec.rpcProvider = rpcReceipts([{ day: '2026-05-02', pence: 9_999 }]);
    const fs = await svc.financeSeries(ORG_A, { months: 12, now, source: 'quickbooks' });
    const may = fs.months.find((m) => m.month === '2026-05');
    expect(may.revenue).toBe(5_000_000); // QBO revenue bucket, not the 9_999 receipts
    expect(may.staffCosts).toBe(1_000_000);
    expect(may.profit).toBe(4_000_000);
    expect(may.costsAvailable).toBe(true);
    expect(fs.source).toBe('quickbooks');
    expect(fs.costsAvailable).toBe(true);
  });

  it('source=quickbooks scopes the read to source=quickbooks (+ account when set)', async () => {
    supaRec.resultProvider = () => ({ data: [], error: null });
    supaRec.rpcProvider = rpcReceipts([]);
    let captured;
    const orig = supaRec.resultProvider;
    supaRec.resultProvider = (q) => {
      if (q.table === 'monthly_financials') captured = q;
      return orig(q);
    };
    await svc.financeSeries(ORG_A, { months: 12, now, source: 'quickbooks', accountId: 'qbo-1' });
    expect(captured.eqs.find((e) => e.col === 'source')?.val).toBe('quickbooks');
    expect(captured.eqs.find((e) => e.col === 'integration_account_id')?.val).toBe('qbo-1');
  });

  it('source=dentally → revenue from receipts; costs/profit forced £0 even when cost actuals exist', async () => {
    supaRec.resultProvider = (q) =>
      q.table === 'monthly_financials'
        ? { data: [{ period: '2026-05', dental_bucket: 'staff', amount_pence: 1_000_000, source: 'xero', practice_id: null }], error: null }
        : { data: [], error: null };
    supaRec.rpcProvider = rpcReceipts([{ day: '2026-05-02', pence: 6_000_000 }]);
    const fs = await svc.financeSeries(ORG_A, { months: 12, now, source: 'dentally' });
    const may = fs.months.find((m) => m.month === '2026-05');
    expect(may.revenue).toBe(6_000_000); // real settled receipts
    expect(may.staffCosts).toBe(0); // Xero/manual cost actuals ignored for Dentally
    expect(may.profit).toBe(0);
    expect(may.costsAvailable).toBe(false);
    expect(fs.source).toBe('dentally');
  });
});

describe('plBenchmark — /profit data-source toggle', () => {
  it('source=dentally → honest empty (Dentally has no cost data), no actuals read', async () => {
    let read = false;
    supaRec.resultProvider = (q) => {
      if (q.table === 'monthly_financials') read = true;
      return { data: [], error: null };
    };
    const r = await svc.plBenchmark(ORG_A, { source: 'dentally' });
    expect(r.costsAvailable).toBe(false);
    expect(r.rows).toEqual([]);
    expect(r.source).toBe('dentally');
    expect(read).toBe(false); // short-circuits before touching monthly_financials
  });

  it('source=quickbooks → benchmark from QBO actuals only, scoped source=quickbooks', async () => {
    let captured;
    supaRec.resultProvider = (q) => {
      if (q.table === 'monthly_financials') {
        captured = q;
        return {
          data: [
            { period: '2026-05', dental_bucket: 'revenue', amount_pence: 10_000_000, source: 'quickbooks', practice_id: null, integration_account_id: 'qbo-1' },
            { period: '2026-05', dental_bucket: 'staff', amount_pence: 2_000_000, source: 'quickbooks', practice_id: null, integration_account_id: 'qbo-1' },
            { period: '2026-05', dental_bucket: 'lab', amount_pence: 1_000_000, source: 'quickbooks', practice_id: null, integration_account_id: 'qbo-1' },
          ],
          error: null,
        };
      }
      return { data: [], error: null };
    };
    const r = await svc.plBenchmark(ORG_A, { source: 'quickbooks', accountId: 'qbo-1' });
    expect(r.costsAvailable).toBe(true);
    expect(r.source).toBe('quickbooks');
    expect(r.rows.length).toBeGreaterThan(0);
    expect(captured.eqs.find((e) => e.col === 'source')?.val).toBe('quickbooks');
    expect(captured.eqs.find((e) => e.col === 'integration_account_id')?.val).toBe('qbo-1');
  });
});

describe('dashboardSummary — Command Centre, exact real-or-zero', () => {
  const now = () => new Date(2026, 4, 15);

  it('no real costs → revenue real (payments), costs/profit/margin 0, cash = bank', async () => {
    supaRec.resultProvider = (q) =>
      q.table === 'monthly_financials' ? { data: [], error: null }
      : q.table === 'bank_accounts' ? { data: [{ balance_pence: 3_000_000, last_synced_at: '2026-05-14T00:00:00Z' }], error: null }
      : { data: { baseline: { revenue: 1_000_000, cost_associates: 30 } }, error: null }; // baseline IGNORED
    supaRec.rpcProvider = rpcReceipts([{ day: '2026-03-01', pence: 100_000_000 }]);
    const r = await svc.dashboardSummary(ORG_A, { now });
    expect(r.basis).toBe('revenue-only');
    expect(r.revenuePence).toBe(100_000_000); // exact real settled payments TTM
    expect(r.totalCostsPence).toBe(0);
    expect(r.netProfitPence).toBe(0);
    expect(r.marginPct).toBe(0);
    expect(r.cashCollectedPence).toBe(100_000_000);
    expect(r.cashflowPence).toBe(3_000_000); // real bank balance
    expect(r.reservePence).toBe(0);
    expect(r.excessCashPence).toBe(3_000_000);
  });

  it('billed production > settled cash → turnover = invoiced, cash = settled (<100%)', async () => {
    supaRec.resultProvider = () =>
      ({ data: [], error: null }); // no monthly_financials actuals, no bank
    supaRec.rpcProvider = (fn) =>
      fn === 'settled_receipts_by_day' ? { data: [{ day: '2026-03-01', pence: 80_000_000 }], error: null }
      : fn === 'treatment_revenue_matrix' ? { data: [{ practice_id: 'p1', treatment_name: 'X', fee_pence: 100_000_000, item_count: 3 }], error: null }
      : { data: [], error: null };
    const r = await svc.dashboardSummary(ORG_A, { now });
    expect(r.turnoverBasis).toBe('billed');
    expect(r.revenuePence).toBe(100_000_000);      // invoiced production
    expect(r.cashCollectedPence).toBe(80_000_000); // settled receipts → 80% collection
  });

  it('turnover = invoiced production even when billed < settled cash (collection rate may exceed 100%)', async () => {
    // Short windows can bank more settled cash (for prior work) than the in-window
    // billing. Turnover still follows billed production so it agrees with Group
    // Overview and never collapses to == cash; cash collected stays settled.
    supaRec.resultProvider = () => ({ data: [], error: null });
    supaRec.rpcProvider = (fn) =>
      fn === 'settled_receipts_by_day' ? { data: [{ day: '2026-03-01', pence: 90_000_000 }], error: null }
      : fn === 'treatment_revenue_matrix' ? { data: [{ practice_id: 'p1', fee_pence: 40_000_000, item_count: 1 }], error: null }
      : { data: [], error: null };
    const r = await svc.dashboardSummary(ORG_A, { now });
    expect(r.turnoverBasis).toBe('billed');
    expect(r.revenuePence).toBe(40_000_000);        // invoiced production
    expect(r.cashCollectedPence).toBe(90_000_000);  // settled receipts (can exceed turnover)
  });

  it('custom range scopes revenue to the period (KPIs follow MTD/QTD/etc.)', async () => {
    supaRec.resultProvider = () => ({ data: [], error: null });
    supaRec.rpcProvider = rpcReceipts([{ day: '2026-05-10', pence: 4_200_000 }]);
    supaRec.rpcCalls = [];
    const r = await svc.dashboardSummary(ORG_A, { now, from: '2026-05-01', to: '2026-05-25' });
    expect(r.basis).toBe('revenue-only');
    expect(r.revenuePence).toBe(4_200_000);       // only the period's settled payments
    expect(r.cashCollectedPence).toBe(4_200_000);
    expect(r.totalCostsPence).toBe(0);            // costs not period-sliceable → 0
    const call = supaRec.rpcCalls.find((c) => c.fn === 'settled_receipts_by_day');
    expect(call.params.p_until).not.toBeNull();   // upper bound applied
  });

  it('monthly_financials actuals → real profit/margin', async () => {
    supaRec.resultProvider = (q) =>
      q.table === 'monthly_financials'
        ? { data: [
            { period: '2026-01', dental_bucket: 'revenue', amount_pence: 10_000_000, source: 'xero' },
            { period: '2026-01', dental_bucket: 'staff', amount_pence: 3_000_000, source: 'xero' },
          ], error: null }
        : { data: [], error: null };
    supaRec.rpcProvider = rpcReceipts([]);
    const r = await svc.dashboardSummary(ORG_A, { now });
    expect(r.basis).toBe('actuals');
    expect(r.revenuePence).toBe(10_000_000);
    expect(r.totalCostsPence).toBe(3_000_000);
    expect(r.netProfitPence).toBe(7_000_000);
    expect(r.marginPct).toBe(70);
  });
});

describe('practiceSummary — real practices + settled payments', () => {
  it('sums settled payments per practice; margin is group-derived', async () => {
    supaRec.resultProvider = (q) => {
      if (q.table === 'practices')
        return {
          data: [
            { id: 'p1', name: 'Ashford' },
            { id: 'p2', name: 'Barnet' },
          ],
          error: null,
        };
      if (q.table === 'payments')
        return {
          data: [
            { practice_id: 'p1', amount_pence: 5000 },
            { practice_id: 'p1', amount_pence: 2000 },
            { practice_id: 'p2', amount_pence: 9000 },
            { practice_id: null, amount_pence: 999 }, // unassigned → excluded
          ],
          error: null,
        };
      return { data: { baseline: { revenue: 1_000_000, cost_associates: 30 } }, error: null };
    };
    const r = await svc.practiceSummary(ORG_A);
    expect(r.groupDerived).toBe(true);
    expect(r.truncated).toBe(false);
    expect(r.marginPct).toBe(70);
    expect(r.practices).toEqual([
      { name: 'Ashford', turnoverPence: 7000, marginPct: 70 },
      { name: 'Barnet', turnoverPence: 9000, marginPct: 70 },
    ]);
  });
});

describe('financial — exact revenue, costs/balance-sheet real-or-zero', () => {
  const now = () => new Date(2026, 4, 15);

  it('{error} when no revenue and no actuals', async () => {
    supaRec.resultProvider = (q) =>
      q.table === 'business_health' ? { data: { baseline: {} }, error: null } : { data: [], error: null };
    supaRec.rpcProvider = rpcReceipts([]);
    expect(await svc.financial(ORG_A, { now })).toEqual({ error: 'No revenue data' });
  });

  it('real payment revenue, NO cost source → margins 0, balance sheet 0 except real bank', async () => {
    supaRec.resultProvider = (q) => {
      if (q.table === 'monthly_financials') return { data: [], error: null };
      if (q.table === 'bank_accounts')
        return { data: [{ balance_pence: 5_000_000, last_synced_at: '2026-05-14T00:00:00Z' }], error: null };
      return { data: { baseline: { revenue: 1_000_000, cost_staff: 30 } }, error: null }; // baseline must be IGNORED
    };
    supaRec.rpcProvider = rpcReceipts([{ day: '2026-03-01', pence: 100_000_000 }]);
    const r = await svc.financial(ORG_A, { dsoDays: 45, payableDays: 30, now });
    expect(r.basis).toBe('revenue-only');
    expect(r.revenuePence).toBe(100_000_000); // exact real revenue
    expect(r.costsAvailable).toBe(false);
    // No cost source → margins 0 (NOT 100%, NOT a baseline estimate)
    expect(r.ratios.find((x) => x.key === 'grossMarginPct')).toMatchObject({ value: 0, estimated: false });
    expect(r.ratios.find((x) => x.key === 'netMarginPct')).toMatchObject({ value: 0, estimated: false });
    // Balance sheet: only real bank cash; everything else 0
    expect(r.balanceSheet.cashPence).toEqual({ value: 5_000_000, estimated: false });
    expect(r.balanceSheet.receivablesPence).toEqual({ value: 0, estimated: false });
    expect(r.balanceSheet.currentLiabilitiesPence).toEqual({ value: 0, estimated: false });
    expect(r.balanceSheet.equityPence).toEqual({ value: 5_000_000, estimated: false });
  });

  it('monthly_financials actuals → real margins (estimated:false)', async () => {
    supaRec.resultProvider = (q) =>
      q.table === 'monthly_financials'
        ? { data: [
            { period: '2026-01', dental_bucket: 'revenue', amount_pence: 10_000_000, source: 'xero' },
            { period: '2026-01', dental_bucket: 'lab', amount_pence: 2_000_000, source: 'xero' },
            { period: '2026-01', dental_bucket: 'staff', amount_pence: 3_000_000, source: 'xero' },
          ], error: null }
        : { data: [], error: null };
    supaRec.rpcProvider = rpcReceipts([]);
    const r = await svc.financial(ORG_A, { now });
    expect(r.basis).toBe('actuals');
    expect(r.costsAvailable).toBe(true);
    // COGS = lab 2m → gross 80%; total costs 5m → net 50%
    expect(r.ratios.find((x) => x.key === 'grossMarginPct')).toMatchObject({ value: 80, estimated: false });
    expect(r.ratios.find((x) => x.key === 'netMarginPct')).toMatchObject({ value: 50, estimated: false });
  });
});

describe('cashflow — backward real settled receipts (no projection)', () => {
  const now = () => new Date(2026, 4, 15); // Fri 15 May 2026

  it('no receipts → 13 real zero weeks, opening 0', async () => {
    supaRec.resultProvider = () => ({ data: [], error: null });
    supaRec.rpcProvider = rpcReceipts([]);
    const r = await svc.cashflow(ORG_A, { now });
    expect(r.basis).toBe('actuals');
    expect(r.weeks).toHaveLength(13);
    expect(r.openingBalancePence).toBe(0);
    expect(r.weeks.every((w) => w.receiptsPence === 0)).toBe(true);
    expect(r.totalReceiptsPence).toBe(0);
  });

  it('opening = Σ bank; exact receipts bucketed backward by week', async () => {
    supaRec.resultProvider = (q) =>
      q.table === 'bank_accounts'
        ? { data: [
            { balance_pence: 400_000, last_synced_at: '2026-05-14T00:00:00Z' },
            { balance_pence: 100_000, last_synced_at: '2026-05-10T00:00:00Z' },
          ], error: null }
        : { data: [], error: null };
    // exact daily receipts: today £250 (latest week), a week back £100
    supaRec.rpcProvider = rpcReceipts([
      { day: '2026-05-15', pence: 25_000 },
      { day: '2026-05-08', pence: 10_000 },
    ]);
    const r = await svc.cashflow(ORG_A, { weeks: 13, now });
    expect(r.basis).toBe('actuals');
    expect(r.bankConnected).toBe(true);
    expect(r.bankStale).toBe(false);
    expect(r.openingBalancePence).toBe(500_000);
    expect(r.weeks).toHaveLength(13);
    expect(r.weeks[0].openingBalancePence).toBe(500_000);
    expect(r.weeks[12].receiptsPence).toBe(25_000); // today in the latest week
    expect(r.weeks[12].closingBalancePence).toBe(500_000 + 10_000 + 25_000);
    expect(r.totalReceiptsPence).toBe(35_000);
    expect(r).not.toHaveProperty('baselineWeeklyRunRatePence'); // no baseline anymore
  });

  it('no bank rows → opening 0, bankStale true, still 13 real weeks', async () => {
    supaRec.resultProvider = () => ({ data: [], error: null });
    supaRec.rpcProvider = rpcReceipts([]);
    const r = await svc.cashflow(ORG_A, { now });
    expect(r.bankConnected).toBe(false);
    expect(r.bankStale).toBe(true);
    expect(r.openingBalancePence).toBe(0);
    expect(r.weeks).toHaveLength(13);
  });

  it('per-practice: practice_id is passed to the receipts RPC', async () => {
    supaRec.resultProvider = () => ({ data: [], error: null });
    supaRec.rpcProvider = rpcReceipts([]);
    supaRec.rpcCalls = [];
    await svc.cashflow(ORG_A, { now, practiceId: 'prac-11111111' });
    const call = supaRec.rpcCalls.find((c) => c.fn === 'settled_receipts_by_day');
    expect(call.params).toMatchObject({ p_org: ORG_A, p_practice: 'prac-11111111' });
  });
});

describe('cashflowOutlook — cash IN is settled receipts, never billed production', () => {
  const now = () => new Date(2026, 4, 15); // May 2026 → window Feb..May

  it('IN = settled cash for the month, NOT the (higher) billed turnover', async () => {
    // No cost actuals (default empty tables) → Dentally-only org. Settled cash
    // for Mar is LESS than billed production for Mar (billed-but-not-collected
    // gap). Cash IN must be the settled figure, or the cashflow card overstates.
    supaRec.resultProvider = () => ({ data: [], error: null });
    supaRec.rpcProvider = (fn) => {
      if (fn === 'settled_receipts_by_day') return { data: [{ day: '2026-03-20', pence: 30_911_176 }], error: null };
      if (fn === 'billed_revenue_by_month') return { data: [{ month: '2026-03', pence: 37_861_002 }], error: null };
      return { data: [], error: null };
    };
    const r = await svc.cashflowOutlook(ORG_A, { months: 4, forward: 2, now });
    const mar = r.months.find((m) => m.month === '2026-03');
    expect(mar.inPence).toBe(30_911_176); // settled cash, not 37,861,002 billed
  });

  it('names the cash-in feed from the settled-payment source (e.g. Dentally)', async () => {
    supaRec.resultProvider = (q) =>
      q.table === 'payments' ? { data: [{ source: 'dentally' }], error: null } : { data: [], error: null };
    supaRec.rpcProvider = (fn) =>
      fn === 'settled_receipts_by_day' ? { data: [{ day: '2026-03-20', pence: 30_911_176 }], error: null } : { data: [], error: null };
    const r = await svc.cashflowOutlook(ORG_A, { months: 4, forward: 2, now });
    expect(r.inSource).toBe('Dentally');
  });

  it('no cost source → costsBasis none, out flagged unavailable', async () => {
    supaRec.resultProvider = () => ({ data: [], error: null });
    supaRec.rpcProvider = (fn) =>
      fn === 'settled_receipts_by_day' ? { data: [{ day: '2026-03-20', pence: 1_000_000 }], error: null } : { data: [], error: null };
    const r = await svc.cashflowOutlook(ORG_A, { months: 4, forward: 2, now });
    expect(r.costsBasis).toBe('none');
    expect(r.costsAvailable).toBe(false);
    expect(r.months.every((m) => m.costsAvailable === false)).toBe(true);
  });
});

describe('aiInsights — locked D-Q2 definitions over real leads/payments', () => {
  const now = () => new Date(2026, 4, 15);
  const dataset = (q) => {
    if (q.table === 'leads')
      return {
        data: [
          { status: 'treatment_started', practice_id: 'p1', source: 'Meta', estimated_value_pence: 1000 },
          { status: 'treatment_completed', practice_id: 'p1', source: 'Meta', estimated_value_pence: 2000 },
          { status: 'new', practice_id: 'p1', source: 'Google', estimated_value_pence: 3000 },
          { status: 'not_proceeding', practice_id: 'p2', source: null, estimated_value_pence: 4000 },
          { status: 'consultation_booked', practice_id: null, source: '', estimated_value_pence: 5000 },
        ],
        error: null,
      };
    if (q.table === 'payments')
      return {
        data: [
          { practice_id: 'p1', amount_pence: 7000 },
          { practice_id: 'p2', amount_pence: 9000 },
          { practice_id: null, amount_pence: 999 },
        ],
        error: null,
      };
    return {
      data: [
        { id: 'p1', name: 'Ashford' },
        { id: 'p2', name: 'Barnet' },
      ],
      error: null,
    };
  };

  it('per-practice: NULL practice excluded, conv=(started+completed)/total, rev30d=settled', async () => {
    supaRec.resultProvider = dataset;
    const r = await svc.aiInsights(ORG_A, { days: 30, now });
    expect(r.basis).toBe('live');
    expect(r.truncated).toBe(false);
    const ash = r.practices.find((p) => p.name === 'Ashford');
    const barn = r.practices.find((p) => p.name === 'Barnet');
    expect(ash).toEqual({ name: 'Ashford', conversionRate: 66.7, revenue30dPence: 7000 });
    expect(barn).toEqual({ name: 'Barnet', conversionRate: 0, revenue30dPence: 9000 });
    expect(r.practices).toHaveLength(2); // null practice_id never appears
  });

  it('per-source: NULL/empty → Direct/Unknown, pipeline excludes 3 terminal statuses', async () => {
    supaRec.resultProvider = dataset;
    const r = await svc.aiInsights(ORG_A, { days: 30, now });
    const meta = r.sources.find((s) => s.name === 'Meta');
    const google = r.sources.find((s) => s.name === 'Google');
    const direct = r.sources.find((s) => s.name === 'Direct/Unknown');
    // Meta: 2 leads, both converted; completed(2000) excluded from pipeline,
    // started(1000) counts.
    expect(meta).toEqual({ name: 'Meta', conversionRate: 100, leads: 2, pipelineValuePence: 1000 });
    // Google: 1 'new' lead → 0% conv, pipeline 3000.
    expect(google).toEqual({ name: 'Google', conversionRate: 0, leads: 1, pipelineValuePence: 3000 });
    // null + '' sources merge → Direct/Unknown: not_proceeding(excluded) +
    // consultation_booked(5000 counts) = 5000; 0 conversions.
    expect(direct).toEqual({ name: 'Direct/Unknown', conversionRate: 0, leads: 2, pipelineValuePence: 5000 });
  });

  it('windows leads by injected clock (since = now - days)', async () => {
    supaRec.resultProvider = dataset;
    await svc.aiInsights(ORG_A, { days: 7, now });
    const since = new Date(2026, 4, 15).getTime() - 7 * 86400000;
    const gte = supaRec.last.gtes?.find((g) => g.col === 'created_at');
    // last query may be practices; assert the leads query carried the window.
    expect(new Date(gte?.val ?? since).getTime()).toBeLessThanOrEqual(
      new Date(2026, 4, 15).getTime(),
    );
  });
});

describe('generateInsights — no-data short-circuit (no Claude call)', () => {
  it('returns {error} without calling the model when nothing to analyse', async () => {
    // baselineMaybe → {baseline:{}}, leads/payments/practices → []
    supaRec.resultProvider = (q) =>
      q.table === 'business_health'
        ? { data: { baseline: {} }, error: null }
        : { data: [], error: null };
    const r = await svc.generateInsights(ORG_A);
    expect(r).toEqual({ basis: 'ai', insights: [], error: 'No data to analyse' });
  });
});

describe('CROSS-ORG ISOLATION (CRITICAL) — every new query pins org', () => {
  it('leadsInWindow pins org and carries the created_at window', async () => {
    await repo.leadsInWindow(ORG_A, '2026-04-01T00:00:00.000Z');
    expect(supaRec.last.table).toBe('leads');
    expect(orgFilter(supaRec.last)).toEqual({
      col: 'organisation_id',
      val: ORG_A,
    });
    expect(supaRec.last.gtes).toContainEqual({
      col: 'created_at',
      val: '2026-04-01T00:00:00.000Z',
    });
    expect(supaRec.last.eqs.some((e) => e.val === ORG_B)).toBe(false);
  });

  it('settledPaymentsInWindow pins org AND status=settled, never foreign', async () => {
    await repo.settledPaymentsInWindow(ORG_A, '2026-04-01T00:00:00.000Z');
    expect(supaRec.last.table).toBe('payments');
    expect(orgFilter(supaRec.last)).toEqual({
      col: 'organisation_id',
      val: ORG_A,
    });
    expect(supaRec.last.eqs).toContainEqual({ col: 'status', val: 'settled' });
    expect(supaRec.last.gtes).toContainEqual({
      col: 'processed_at',
      val: '2026-04-01T00:00:00.000Z',
    });
    expect(supaRec.last.eqs.some((e) => e.val === ORG_B)).toBe(false);
  });
});

describe('CROSS-ORG ISOLATION — dashboard queries pin org', () => {
  it('practicesList filters by caller org, never another', async () => {
    await repo.practicesList(ORG_A);
    expect(supaRec.last.table).toBe('practices');
    expect(orgFilter(supaRec.last)).toEqual({
      col: 'organisation_id',
      val: ORG_A,
    });
    expect(supaRec.last.eqs.some((e) => e.val === ORG_B)).toBe(false);
  });

  it('settledPayments pins org AND status, never a foreign org', async () => {
    await repo.settledPayments(ORG_A);
    expect(supaRec.last.table).toBe('payments');
    expect(orgFilter(supaRec.last)).toEqual({
      col: 'organisation_id',
      val: ORG_A,
    });
    expect(supaRec.last.eqs).toContainEqual({ col: 'status', val: 'settled' });
    expect(supaRec.last.eqs.some((e) => e.val === ORG_B)).toBe(false);
  });

  it("an org-A call never targets org B even when org-B rows exist", async () => {
    supaRec.resultProvider = (q) => {
      const f = orgFilter(q);
      return f && f.val === ORG_B
        ? { data: [{ id: 'pB', name: 'Foreign' }], error: null }
        : { data: [], error: null };
    };
    const list = await repo.practicesList(ORG_A);
    expect(list).toEqual([]); // org-A filter excludes the org-B row
    expect(orgFilter(supaRec.last).val).toBe(ORG_A);
    expect(
      supaRec.last.eqs.some(
        (e) => e.col === 'organisation_id' && e.val === ORG_B,
      ),
    ).toBe(false);
  });
});

describe('businessHub — exact per-practice rollups via RPC (no 1000-row cap)', () => {
  // RPC rollups: revenue / appointments / leads aggregated server-side.
  const rollups = (fn) => {
    // Turnover follows billed production (treatment_revenue_matrix); settled
    // payments (settled_revenue_by_practice) become per-practice cash collected.
    // Distinct values so the test proves which source drives turnover.
    if (fn === 'treatment_revenue_matrix')
      return { data: [{ practice_id: 'p1', treatment_name: 'X', fee_pence: 120000, item_count: 2 }, { practice_id: 'p2', treatment_name: 'Y', fee_pence: 60000, item_count: 1 }], error: null };
    if (fn === 'settled_revenue_by_practice')
      return { data: [{ practice_id: 'p1', pence: 100000 }, { practice_id: 'p2', pence: 50000 }], error: null };
    if (fn === 'appointments_rollup_by_practice')
      return { data: [{ practice_id: 'p1', total: 2, completed: 1, no_shows: 1 }, { practice_id: 'p2', total: 1, completed: 1, no_shows: 0 }], error: null };
    if (fn === 'leads_rollup_by_practice')
      return { data: [{ practice_id: 'p1', total: 2, converted: 1 }], error: null };
    return { data: [], error: null };
  };

  it('aggregates exact revenue/appointments/leads per practice + group, sorted by revenue', async () => {
    supaRec.resultProvider = (q) =>
      q.table === 'practices' ? { data: [{ id: 'p1', name: 'Alpha', chairs: 4 }, { id: 'p2', name: 'Beta', chairs: 3 }], error: null }
      : q.table === 'business_health' ? { data: { baseline: { revenue: 1000000 } }, error: null }
      : { data: [], error: null }; // monthly_financials empty → margin 0
    supaRec.rpcProvider = rollups;
    const res = await svc.businessHub(ORG_A, { days: 90, now: () => new Date('2026-05-25T00:00:00Z') });

    expect(res.group.revenuePence).toBe(180000);          // turnover = billed (120k + 60k)
    expect(res.group.appointments).toBe(3);
    expect(res.group.noShows).toBe(1);
    expect(res.group.leads).toBe(2);
    expect(res.group.revenueTargetPence).toBe(100000000); // baseline.revenue * 100 (a target)
    expect(res.group.marginPct).toBe(0);                  // no real cost source → 0, not estimated
    expect(res.truncated).toBe(false);

    expect(res.practices[0]).toMatchObject({
      name: 'Alpha', revenuePence: 120000, cashCollectedPence: 100000, appointments: 2, noShows: 1, noShowRate: 50, leads: 2, conversionRate: 50,
    });
    expect(res.practices[1]).toMatchObject({ name: 'Beta', revenuePence: 60000, cashCollectedPence: 50000, appointments: 1 });
  });

  it('period-over-period deltas compare this window to the prior same-length one (Jun vs May)', async () => {
    supaRec.resultProvider = (q) =>
      q.table === 'practices' ? { data: [{ id: 'p1', name: 'Alpha', chairs: 4 }], error: null }
      : q.table === 'business_health' ? { data: { baseline: {} }, error: null }
      : { data: [], error: null };
    // RPCs are window-aware: current window (Jun) vs prior (May) keyed by p_since.
    supaRec.rpcProvider = (fn, params) => {
      const isPrev = params?.p_since && params.p_since < '2026-06-01';
      if (fn === 'treatment_revenue_matrix')
        return { data: [{ practice_id: 'p1', treatment_name: 'X', fee_pence: isPrev ? 100000 : 112000, item_count: 1 }], error: null };
      if (fn === 'settled_receipts_by_day')
        return { data: [{ day: '2026-05-01', pence: isPrev ? 100000 : 108000 }], error: null };
      return { data: [], error: null };
    };
    const res = await svc.businessHub(ORG_A, { since: '2026-06-01T00:00:00.000Z', until: '2026-07-01T00:00:00.000Z', label: 'Jun 2026' });
    expect(res.group.revenuePence).toBe(112000);
    expect(res.group.prevRevenuePence).toBe(100000);
    expect(res.group.turnoverDeltaPct).toBe(12);   // (112k-100k)/100k
    expect(res.group.cashDeltaPct).toBe(8);        // (108k-100k)/100k
    expect(res.group.prevPeriodLabel).toBe('May 2026');
  });

  it('delta is null when the prior period has no base (avoids a fake 0% / ±∞)', async () => {
    supaRec.resultProvider = (q) =>
      q.table === 'practices' ? { data: [{ id: 'p1', name: 'Alpha', chairs: 4 }], error: null }
      : q.table === 'business_health' ? { data: { baseline: {} }, error: null }
      : { data: [], error: null };
    supaRec.rpcProvider = (fn, params) => {
      const isPrev = params?.p_since && params.p_since < '2026-06-01';
      if (fn === 'treatment_revenue_matrix' && !isPrev)
        return { data: [{ practice_id: 'p1', treatment_name: 'X', fee_pence: 50000, item_count: 1 }], error: null };
      return { data: [], error: null }; // prior window empty
    };
    const res = await svc.businessHub(ORG_A, { since: '2026-06-01T00:00:00.000Z', until: '2026-07-01T00:00:00.000Z' });
    expect(res.group.turnoverDeltaPct).toBeNull();
    expect(res.group.cashDeltaPct).toBeNull();
  });

  it('noShowTracked reflects whether any no_show appointment exists (— vs 0% in the UI)', async () => {
    // No no_show row anywhere -> tracked=false so the UI renders "—" not a
    // misleading 0% (Dentally feeds that never sync a DNA state look like this).
    supaRec.resultProvider = (q) =>
      q.table === 'practices' ? { data: [{ id: 'p1', name: 'Alpha', chairs: 4 }], error: null }
      : q.table === 'business_health' ? { data: { baseline: {} }, error: null }
      : q.table === 'appointments' ? { data: [], error: null }
      : { data: [], error: null };
    supaRec.rpcProvider = rollups;
    const off = await svc.businessHub(ORG_A, { days: 90 });
    expect(off.group.noShowTracked).toBe(false);

    // One no_show row present -> tracked=true so the real rate shows.
    supaRec.resultProvider = (q) =>
      q.table === 'practices' ? { data: [{ id: 'p1', name: 'Alpha', chairs: 4 }], error: null }
      : q.table === 'business_health' ? { data: { baseline: {} }, error: null }
      : q.table === 'appointments' ? { data: [{ id: 'a1' }], error: null }
      : { data: [], error: null };
    const on = await svc.businessHub(ORG_A, { days: 90 });
    expect(on.group.noShowTracked).toBe(true);
  });

  it('counts null-practice GHL leads in the group total and rolls up treatments', async () => {
    supaRec.resultProvider = (q) =>
      q.table === 'practices' ? { data: [{ id: 'p1', name: 'Alpha', chairs: 4 }], error: null }
      : q.table === 'business_health' ? { data: { baseline: {} }, error: null }
      : { data: [], error: null };
    supaRec.rpcProvider = (fn) => {
      // p1 has 1 lead; GHL leads arrive with practice_id null (9 leads). Ad feeds
      // empty here, so group leads = the 10 CRM leads.
      if (fn === 'leads_rollup_by_practice')
        return { data: [{ practice_id: 'p1', total: 1, converted: 0 }, { practice_id: null, total: 9, converted: 2 }], error: null };
      // 2 new patients by payment plan -> conversionRate = 2/10 leads = 20%.
      if (fn === 'org_new_patients_registered_by_practice') return { data: [{ practice_id: 'p1', new_patients: 2 }], error: null };
      if (fn === 'treatments_rollup_by_org')
        return { data: [{ started: 4, completed: 3, closed_value_pence: 120000 }], error: null };
      // Closed VALUE now comes from real invoiced plan fees per practice (distinct
      // RPC), NOT the rollup's planned-estimate closed_value_pence (120000). Group
      // total = sum of the per-practice rows. Prove it overrides the estimate.
      if (fn === 'treatments_closed_revenue_by_practice')
        return { data: [{ practice_id: 'p1', closed_value_pence: 180000, paid_value_pence: 96000 }], error: null };
      return { data: [], error: null };
    };
    const res = await svc.businessHub(ORG_A, { days: 90 });
    expect(res.group.leads).toBe(10);            // 1 practice-attributed + 9 null-practice (CRM; ad feeds empty)
    expect(res.group.conversionRate).toBe(20);   // 2 new patients / 10 leads
    expect(res.practices[0].leads).toBe(1);      // per-practice row still excludes the null bucket
    expect(res.group.treatmentsStarted).toBe(4);
    expect(res.group.treatmentsClosedPence).toBe(180000); // billed plan fees, not 120000 estimate
    expect(res.group.treatmentsPaidPence).toBe(96000);    // collected (paid) subset
    expect(res.practices[0].treatmentsClosedPence).toBe(180000); // attributed per practice (invoice_items feed)
    expect(res.practices[0].treatmentsPaidPence).toBe(96000);
    expect(res.group.leadToStartRate).toBe(40);  // 4 started / 10 leads
  });

  it('leads come from ALL sources (Google + Meta ad conversions + GHL) with a named breakdown; new patients are booked Dentally exams', async () => {
    // CRM/GHL leads empty (Dentally-only org) — the old path showed Leads 0.
    // Real leads live in ad_metrics.conversions; new patients in appointments.
    supaRec.resultProvider = (q) =>
      q.table === 'practices' ? { data: [{ id: 'p1', name: 'Alpha', chairs: 4 }], error: null }
      : q.table === 'business_health' ? { data: { baseline: {} }, error: null }
      : q.table === 'ad_metrics' ? { data: [{ provider: 'google_ads', conversions: 21 }, { provider: 'meta_ads', conversions: 1376 }], error: null }
      : { data: [], error: null };
    supaRec.rpcProvider = (fn) => {
      if (fn === 'leads_rollup_by_practice') return { data: [], error: null }; // GHL empty
      if (fn === 'treatments_rollup_by_org') return { data: [{ started: 310, completed: 152, closed_value_pence: 0 }], error: null };
      if (fn === 'org_new_patients_registered_by_practice') return { data: [{ practice_id: 'p1', new_patients: 35 }], error: null };
      return { data: [], error: null };
    };
    const res = await svc.businessHub(ORG_A, { since: '2026-06-01T00:00:00.000Z', until: '2026-07-01T00:00:00.000Z', label: 'Jun 2026' });

    expect(res.group.leads).toBe(1397);                  // 21 + 1376 + 0 (GHL)
    expect(res.group.leadsBySource).toEqual([
      { source: 'Google Ads', leads: 21 },
      { source: 'Meta Ads', leads: 1376 },
      { source: 'GHL / CRM', leads: 0 },
    ]);
    expect(res.group.newPatients).toBe(35);              // new patients by payment plan (Dentally)
    expect(res.group.conversionRate).toBe(2.5);          // 35 new patients / 1397 leads
    expect(res.group.leadToStartRate).toBe(22.2);        // 310 started / 1397 leads
  });

  it('revenueByLine buckets invoice-item treatments into clinical lines, summed group-wide, sorted desc', async () => {
    supaRec.resultProvider = (q) =>
      q.table === 'practices' ? { data: [{ id: 'p1', name: 'Alpha', chairs: 4 }], error: null }
      : q.table === 'business_health' ? { data: { baseline: {} }, error: null }
      : { data: [], error: null };
    supaRec.rpcProvider = (fn) => {
      if (fn === 'treatment_revenue_matrix')
        return { data: [
          { practice_id: 'p1', treatment_name: 'Placement Of Implant', fee_pence: 500000, item_count: 5 },
          { practice_id: 'p2', treatment_name: 'Implant Crown', fee_pence: 100000, item_count: 2 },     // implant wins over crown
          { practice_id: 'p1', treatment_name: 'Zirconium Crown', fee_pence: 200000, item_count: 3 },   // restorative
          { practice_id: 'p1', treatment_name: 'Scale & Polish', fee_pence: 50000, item_count: 10 },    // hygiene
          { practice_id: 'p1', treatment_name: 'Invisalign', fee_pence: 80000, item_count: 1 },         // ortho
          { practice_id: 'p1', treatment_name: 'GM Smile Package', fee_pence: 0, item_count: 1 },       // zero -> dropped
        ], error: null };
      return { data: [], error: null };
    };
    const res = await svc.businessHub(ORG_A, { days: 90 });
    const byLine = Object.fromEntries(res.revenueByLine.map((l) => [l.line, l]));
    expect(byLine.Implants.fee_pence).toBe(600000);   // 500k + 100k (Implant Crown bucketed as implant)
    expect(byLine.Implants.item_count).toBe(7);
    expect(byLine.Restorative.fee_pence).toBe(200000);
    expect(byLine['Hygiene & Prevention'].fee_pence).toBe(50000);
    expect(byLine.Orthodontics.fee_pence).toBe(80000);
    expect(res.revenueByLine[0].line).toBe('Implants'); // sorted highest first
    expect(res.revenueByLine.find((l) => l.fee_pence === 0)).toBeUndefined(); // zero lines dropped
    // cost/profit: Xero not connected -> cost 0, profit == revenue
    expect(byLine.Implants.cost_pence).toBe(0);
    expect(byLine.Implants.profit_pence).toBe(600000);
    expect(res.revenueLineCostBasis).toBeNull();   // no P&L feed -> gross
    expect(res.revenueLineMarginPct).toBe(0);
  });

  it('allocates per-line cost at the group P&L margin when monthly_financials (Xero) exists', async () => {
    supaRec.resultProvider = (q) =>
      q.table === 'practices' ? { data: [{ id: 'p1', name: 'Alpha', chairs: 4 }], error: null }
      : q.table === 'business_health' ? { data: { baseline: {} }, error: null }
      : q.table === 'monthly_financials' ? { data: [
          { period: '2026-01', dental_bucket: 'revenue', amount_pence: 10_000_000, source: 'xero' },
          { period: '2026-01', dental_bucket: 'staff', amount_pence: 3_000_000, source: 'xero' },
        ], error: null }
      : { data: [], error: null };
    supaRec.rpcProvider = (fn) => {
      if (fn === 'treatment_revenue_matrix')
        return { data: [
          { practice_id: 'p1', treatment_name: 'Placement Of Implant', fee_pence: 1_000_000, item_count: 5 },
          { practice_id: 'p1', treatment_name: 'Scale & Polish', fee_pence: 200_000, item_count: 10 },
        ], error: null };
      return { data: [], error: null };
    };
    const res = await svc.businessHub(ORG_A, { days: 90 });
    expect(res.group.marginPct).toBe(70);          // 10M rev / 3M staff -> 70% net
    expect(res.revenueLineCostBasis).toBe('pl_margin');
    expect(res.revenueLineMarginPct).toBe(70);
    const impl = res.revenueByLine.find((l) => l.line === 'Implants');
    expect(impl.profit_pence).toBe(700_000);       // 1,000,000 * 70%
    expect(impl.cost_pence).toBe(300_000);          // revenue - profit
  });

  it('org-scoped: table queries + every rollup RPC pin the org', async () => {
    const tables = [];
    supaRec.resultProvider = (q) => {
      tables.push({ table: q.table, org: q.eqs.find((e) => e.col === 'organisation_id')?.val });
      return q.table === 'business_health' ? { data: { baseline: {} }, error: null } : { data: [], error: null };
    };
    supaRec.rpcProvider = () => ({ data: [], error: null });
    supaRec.rpcCalls = [];
    await svc.businessHub(ORG_B, { days: 90 });
    expect(tables.filter((t) => t.org === ORG_B).length).toBe(tables.length);
    expect(supaRec.rpcCalls.length).toBeGreaterThanOrEqual(3);
    expect(supaRec.rpcCalls.every((c) => c.params.p_org === ORG_B)).toBe(true);
  });
});

describe('businessHub — Takings, Treatments Completed value, Treatments Accepted', () => {
  // The gating helper caches per-org (30s TTL); clear it so emergent-connected
  // state doesn't bleed between cases that reuse ORG_A.
  beforeEach(() => invalidateGating(ORG_A));

  it('takings = settled receipts (group) + per-practice settled; completed value surfaced', async () => {
    supaRec.resultProvider = (q) =>
      q.table === 'practices' ? { data: [{ id: 'p1', name: 'Alpha', chairs: 4 }, { id: 'p2', name: 'Beta', chairs: 3 }], error: null }
      : q.table === 'business_health' ? { data: { baseline: {} }, error: null }
      : { data: [], error: null }; // integrations empty → emergent NOT connected
    supaRec.rpcProvider = (fn) => {
      if (fn === 'settled_revenue_by_practice') // per-practice takings
        return { data: [{ practice_id: 'p1', pence: 100000 }, { practice_id: 'p2', pence: 50000 }], error: null };
      if (fn === 'settled_receipts_by_day')     // group takings (== Patient Payments "Received")
        return { data: [{ day: '2026-05-01', pence: 90000 }, { day: '2026-05-02', pence: 60000 }], error: null };
      if (fn === 'treatments_rollup_by_org')    // completed count + value
        return { data: [{ started: 9, completed: 4, closed_value_pence: 720000 }], error: null };
      return { data: [], error: null };
    };
    supaRec.rpcCalls = [];
    const res = await svc.businessHub(ORG_A, { days: 90, now: () => new Date('2026-05-25T00:00:00Z') });

    // Takings: group = sum of settled receipts; per-practice = settled-by-practice.
    expect(res.group.takingsPence).toBe(150000);
    expect(res.practices.find((p) => p.name === 'Alpha').takingsPence).toBe(100000);
    expect(res.practices.find((p) => p.name === 'Beta').takingsPence).toBe(50000);

    // Treatments Completed: count + private-treatment value (practitioner activity).
    expect(res.group.treatmentsCompleted).toBe(4);
    expect(res.group.treatmentsCompletedValuePence).toBe(720000);

    // Treatments Accepted: emergent not connected → zeros, and the aggregate RPC
    // is NEVER called (so the still-blocked table/RPC isn't required on hosted).
    expect(res.group.treatmentsAcceptedCount).toBe(0);
    expect(res.group.treatmentsAcceptedValuePence).toBe(0);
    expect(supaRec.rpcCalls.some((c) => c.fn === 'treatment_accepted_aggregate')).toBe(false);
  });

  it('treatments accepted flow from the aggregate RPC once emergent is connected', async () => {
    supaRec.resultProvider = (q) =>
      q.table === 'practices' ? { data: [{ id: 'p1', name: 'Alpha', chairs: 4 }], error: null }
      : q.table === 'business_health' ? { data: { baseline: {} }, error: null }
      : q.table === 'integrations' ? { data: [{ provider: 'emergent', status: 'active' }], error: null }
      : { data: [], error: null };
    supaRec.rpcProvider = (fn) => {
      if (fn === 'treatment_accepted_aggregate')
        return { data: [{ accepted_count: 7, accepted_value_pence: 4200000 }], error: null };
      return { data: [], error: null };
    };
    supaRec.rpcCalls = [];
    const res = await svc.businessHub(ORG_A, { days: 90 });
    expect(res.group.treatmentsAcceptedCount).toBe(7);
    expect(res.group.treatmentsAcceptedValuePence).toBe(4200000);
    expect(supaRec.rpcCalls.some((c) => c.fn === 'treatment_accepted_aggregate')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// baselineAsOf — the AI must ground a CLOSED (past) period on the baseline/
// targets that were in effect THEN (business_health_snapshots.inputs, 000054),
// not today's overwrite-in-place business_health blob. A window ending on/after
// today is the live current period. Missing snapshot fields fall back to live.
// ---------------------------------------------------------------------------
describe('baselineAsOf — historised vs live manual baseline for AI grounding', () => {
  const { baselineAsOf } = analyticsTest;
  const NOW = new Date('2026-06-16T09:00:00Z');
  const ORG = 'org-asof';
  const LIVE = { baseline: { rev: 'live' }, targets: { rev: 'liveT' } };
  const SNAP = { baseline: { rev: 'snap' }, targets: { rev: 'snapT' } };

  afterEach(() => vi.restoreAllMocks());

  it('current period (window ends on/after today) → uses the live blob, never reads a snapshot', async () => {
    const live = vi.spyOn(repo, 'baselineMaybe').mockResolvedValue(LIVE);
    const asof = vi.spyOn(bhRepo, 'getInputsAsOf').mockResolvedValue(SNAP);
    // June 2026 exclusive end = 2026-07-01 → asOfDate 2026-06-30 >= today.
    const out = await baselineAsOf(ORG, { until: '2026-07-01T00:00:00.000Z' }, NOW);
    expect(asof).not.toHaveBeenCalled();
    expect(live).toHaveBeenCalledWith(ORG);
    expect(out).toEqual(LIVE);
  });

  it('past period → reads the snapshot as-of the period last day and grounds on it', async () => {
    vi.spyOn(repo, 'baselineMaybe').mockResolvedValue(LIVE);
    const asof = vi.spyOn(bhRepo, 'getInputsAsOf').mockResolvedValue(SNAP);
    // Sept 2025 exclusive end = 2025-10-01 → asOfDate is the period last day 2025-09-30.
    const out = await baselineAsOf(ORG, { until: '2025-10-01T00:00:00.000Z' }, NOW);
    expect(asof).toHaveBeenCalledWith(ORG, '2025-09-30');
    expect(out).toEqual(SNAP);
  });

  it('past period, partial snapshot → missing fields fall back to the live blob', async () => {
    vi.spyOn(repo, 'baselineMaybe').mockResolvedValue(LIVE);
    vi.spyOn(bhRepo, 'getInputsAsOf').mockResolvedValue({ baseline: { rev: 'snap' } }); // no targets
    const out = await baselineAsOf(ORG, { until: '2025-10-01T00:00:00.000Z' }, NOW);
    expect(out).toEqual({ baseline: { rev: 'snap' }, targets: LIVE.targets });
  });

  it('past period, no snapshot yet → falls back entirely to the live blob (no fabrication)', async () => {
    vi.spyOn(repo, 'baselineMaybe').mockResolvedValue(LIVE);
    vi.spyOn(bhRepo, 'getInputsAsOf').mockResolvedValue(null);
    const out = await baselineAsOf(ORG, { until: '2025-10-01T00:00:00.000Z' }, NOW);
    expect(out).toEqual(LIVE);
  });
});

// Drill-down behind the "Plan Fees Collected" card. The list comes from
// plan_fees_collected_lines (one row per invoice line); the header totals come
// from the aggregate treatments_closed_revenue_by_practice so they reconcile to
// the tile exactly. Practice scope filters both.
describe('planFeesLines — invoice-line drill-down + canonical totals', () => {
  const since = '2026-06-01T00:00:00.000Z';
  const until = '2026-07-01T00:00:00.000Z';
  const PRAC_1 = 'prac-11111111';
  const PRAC_2 = 'prac-22222222';
  const lineRows = [
    { invoice_item_id: 'ii-1', invoiced_on: '2026-06-10', practice_id: PRAC_1, practice_name: 'Ashford',
      patient_name: 'Jane Doe', treatment_name: 'Implant', treatment_plan_id: 'tp-9', invoice_id: 'inv-1',
      billed_pence: 100000, collected_pence: 90000, invoice_amount_pence: 120000, invoice_outstanding_pence: 12000 },
    { invoice_item_id: 'ii-2', invoiced_on: '2026-06-12', practice_id: PRAC_2, practice_name: 'Rochester',
      patient_name: 'John Roe', treatment_name: 'Crown', treatment_plan_id: 'tp-8', invoice_id: 'inv-2',
      billed_pence: 50000, collected_pence: 50000, invoice_amount_pence: 50000, invoice_outstanding_pence: 0 },
  ];
  const aggRows = [
    { practice_id: PRAC_1, closed_value_pence: 100000, paid_value_pence: 90001 }, // 90001 => proves header uses aggregate, not summed lines
    { practice_id: PRAC_2, closed_value_pence: 50000, paid_value_pence: 50000 },
  ];
  const stub = (lines, agg) => (fn) =>
    fn === 'plan_fees_collected_lines' ? { data: lines, error: null }
    : fn === 'treatments_closed_revenue_by_practice' ? { data: agg, error: null }
    : { data: null, error: { message: `rpc ${fn} not stubbed` } };

  beforeEach(() => { invalidateGating(ORG_A); });

  it('maps lines to camelCase and takes group totals from the aggregate (not the rounded line sum)', async () => {
    supaRec.rpcProvider = stub(lineRows, aggRows);
    const out = await svc.planFeesLines(ORG_A, { since, until, label: 'Jun 2026' });
    expect(out.window).toEqual({ since, until, label: 'Jun 2026' });
    expect(out.totals).toEqual({ billedPence: 150000, collectedPence: 140001, lineCount: 2 });
    expect(out.lines).toHaveLength(2);
    expect(out.lines[0]).toMatchObject({
      id: 'ii-1', invoicedOn: '2026-06-10', practiceId: PRAC_1, practiceName: 'Ashford',
      patientName: 'Jane Doe', treatmentName: 'Implant', treatmentPlanId: 'tp-9', invoiceId: 'inv-1',
      billedPence: 100000, collectedPence: 90000, invoiceAmountPence: 120000, invoiceOutstandingPence: 12000,
    });
  });

  it('scopes the canonical totals to the selected practice', async () => {
    supaRec.rpcProvider = stub(lineRows.filter((r) => r.practice_id === PRAC_1), aggRows);
    const out = await svc.planFeesLines(ORG_A, { since, until, practiceId: PRAC_1 });
    expect(out.totals).toEqual({ billedPence: 100000, collectedPence: 90001, lineCount: 1 });
  });
});

// Drill-down behind the "Treatments Completed" card (shown on the Clinicians
// page): one row per completed treatment with patient, clinician, treatment and
// the revenue it generated, sourced from dentally_treatment_items via RPC.
describe('treatmentsCompletedLines — completed-treatment detail', () => {
  const since = '2026-06-01T00:00:00.000Z';
  const until = '2026-07-01T00:00:00.000Z';
  const rows = [
    { item_id: 'ti-1', completed_at: '2026-06-10T09:00:00.000Z', practice_id: 'prac-1', practice_name: 'Ashford',
      patient_name: 'Jane Doe', clinician_name: 'Dr Smith', treatment_name: 'Implant', value_pence: 120000 },
    { item_id: 'ti-2', completed_at: '2026-06-11T10:00:00.000Z', practice_id: 'prac-1', practice_name: 'Ashford',
      patient_name: null, clinician_name: 'Dr Smith', treatment_name: 'Crown', value_pence: 50000 },
  ];
  // totals come from the aggregate (whole-window count + value), NOT from the
  // page of lines — so they stay correct under pagination.
  const stub = (fn) => fn === 'treatments_completed_lines' ? { data: rows, error: null }
    : fn === 'treatments_completed_by_practice' ? { data: [{ practice_id: 'prac-1', completed_count: 1813, value_pence: 36525689 }], error: null }
    : { data: null, error: { message: `rpc ${fn} not stubbed` } };

  beforeEach(() => { invalidateGating(ORG_A); supaRec.rpcCalls = []; });

  it('maps rows to camelCase, takes totals from the aggregate, keeps a null patient honest', async () => {
    supaRec.rpcProvider = stub;
    const out = await svc.treatmentsCompletedLines(ORG_A, { since, until, label: 'Jun 2026', scope: 'all' });
    // totals over the whole window (aggregate), not the 2-row page.
    expect(out.totals).toEqual({ count: 1813, valuePence: 36525689 });
    expect(out.lines).toHaveLength(2);
    expect(out.lines[0]).toMatchObject({
      id: 'ti-1', practiceName: 'Ashford', patientName: 'Jane Doe',
      clinicianName: 'Dr Smith', treatmentName: 'Implant', valuePence: 120000,
    });
    expect(out.lines[1].patientName).toBeNull();
  });

  it('paginates: passes limit/offset to the RPC and omits totals after the first page', async () => {
    supaRec.rpcProvider = stub;
    const out = await svc.treatmentsCompletedLines(ORG_A, { since, until, scope: 'all', limit: 100, offset: 100 });
    const call = supaRec.rpcCalls.find((c) => c.fn === 'treatments_completed_lines');
    expect(call.params).toMatchObject({ p_limit: 100, p_offset: 100 });
    expect(out.totals).toBeNull(); // only computed on offset 0
    // no aggregate call on later pages
    expect(supaRec.rpcCalls.find((c) => c.fn === 'treatments_completed_by_practice')).toBeUndefined();
  });

  it('passes the selected practice scope through to the RPC', async () => {
    supaRec.rpcProvider = stub;
    await svc.treatmentsCompletedLines(ORG_A, { since, until, scope: 'prac-9' });
    const call = supaRec.rpcCalls.find((c) => c.fn === 'treatments_completed_lines');
    expect(call.params.p_practice).toBe('prac-9');
  });
});
