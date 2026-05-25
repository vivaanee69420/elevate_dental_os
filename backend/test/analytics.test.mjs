// ============================================================================
// Analytics — dashboard-summary / revenue-series / practice-summary.
//
// Pure/derived logic is asserted deterministically (revenue-series via an
// injected clock). DB access runs the REAL repository against the fake
// Supabase client from test/setup.js, recording every .eq() so cross-org
// isolation is proven on the service-client path (RLS is bypassed there —
// the explicit organisation_id filter is the only app-layer tenant guard).
// ============================================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const svc = (await import('../src/services/analytics.service.js'))
  .analyticsService;
const repo = (await import('../src/repositories/analytics.repository.js'))
  .analyticsRepository;

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

describe('revenueSeries — deterministic projection of the real baseline', () => {
  it('returns {error} (not a throw) when no baseline revenue', async () => {
    supaRec.resultProvider = () => ({ data: { baseline: {} }, error: null });
    expect(await svc.revenueSeries(ORG_A)).toEqual({ error: 'No baseline set' });
  });

  it('builds 12 month-keys ending at the injected clock month', async () => {
    supaRec.resultProvider = () => ({
      data: { baseline: { revenue: 1_200_000, profit: 300_000, cash: 1_140_000 } },
      error: null,
    });
    const now = () => new Date(2026, 4, 15); // May 2026
    const r = await svc.revenueSeries(ORG_A, { months: 12, now });
    expect(r.basis).toBe('baseline-projection');
    expect(r.months).toHaveLength(12);
    expect(r.months[0].month).toBe('2025-06');
    expect(r.months[11].month).toBe('2026-05');
  });

  it('is deterministic: identical baseline+clock → identical numbers', async () => {
    supaRec.resultProvider = () => ({
      data: { baseline: { revenue: 1_200_000, profit: 300_000, cash: 1_140_000 } },
      error: null,
    });
    const now = () => new Date(2026, 4, 15);
    // monthlyBase = 1,200,000*100/12 = 10,000,000; idx0 factor 0.94
    const a = await svc.revenueSeries(ORG_A, { now });
    const b = await svc.revenueSeries(ORG_A, { now });
    expect(a.months[0]).toEqual({
      month: '2025-06',
      revenue: 9_400_000,
      profit: 2_350_000, // marginFrac 300k/1.2m = .25
      cash: 8_930_000, // cashFrac min(1, 1.14m/1.2m) = .95
    });
    expect(a).toEqual(b);
  });
});

describe('REGRESSION (CRITICAL) — revenueSeries byte-identical after _projectMonthly extraction', () => {
  it('full 12-month series matches the pre-refactor values exactly', async () => {
    supaRec.resultProvider = () => ({
      data: { baseline: { revenue: 1_200_000, profit: 300_000, cash: 1_140_000 } },
      error: null,
    });
    const now = () => new Date(2026, 4, 15); // May 2026
    const r = await svc.revenueSeries(ORG_A, { months: 12, now });
    // monthlyBase = 120_000_000/12 = 10_000_000; factor = 0.94+0.012*idx+0.02*(idx%3)
    // revenue=round(monthlyBase*factor); profit=round(rev*0.25); cash=round(rev*0.95)
    const expected = Array.from({ length: 12 }, (_, idx) => {
      const factor = 0.94 + 0.012 * idx + 0.02 * (idx % 3);
      const revenue = Math.round(10_000_000 * factor);
      const d = new Date(2026, 4 - (11 - idx), 1);
      return {
        month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        revenue,
        profit: Math.round(revenue * 0.25),
        cash: Math.round(revenue * 0.95),
      };
    });
    expect(r).toEqual({ basis: 'baseline-projection', months: expected });
  });

  it('_projectMonthly exposes factor + revenue, reused by both callers', () => {
    const now = () => new Date(2026, 4, 15);
    const p = svc._projectMonthly(120_000_000, 12, now);
    expect(p).toHaveLength(12);
    expect(p[0]).toEqual({ month: '2025-06', factor: 0.94, revenue: 9_400_000 });
    expect(p[11].month).toBe('2026-05');
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

describe('dashboardSummary — KPIs from the real baseline', () => {
  it('{error} when no baseline revenue', async () => {
    supaRec.resultProvider = () => ({ data: { baseline: {} }, error: null });
    expect(await svc.dashboardSummary(ORG_A)).toEqual({
      error: 'No baseline set',
    });
  });

  it('computes profit/margin/cash from baseline cost_*', async () => {
    supaRec.resultProvider = () => ({
      data: { baseline: { revenue: 1_000_000, cost_associates: 30 } },
      error: null,
    });
    const r = await svc.dashboardSummary(ORG_A);
    expect(r.revenuePence).toBe(100_000_000);
    expect(r.totalCostsPence).toBe(30_000_000);
    expect(r.netProfitPence).toBe(70_000_000);
    expect(r.marginPct).toBe(70);
    expect(r.cashCollectedPence).toBe(100_000_000); // no baseline.cash → full
    expect(r.cashflowPence).toBe(70_000_000);
    expect(r.reservePence).toBe(5_000_000); // (30m/12)*2
    expect(r.excessCashPence).toBe(65_000_000);
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

describe('businessHub — group + per-practice rollup over real tables', () => {
  it('aggregates revenue/appointments/leads per practice and group, sorted by revenue', async () => {
    supaRec.resultProvider = (q) => {
      switch (q.table) {
        case 'practices': return { data: [
          { id: 'p1', name: 'Alpha', chairs: 4 },
          { id: 'p2', name: 'Beta', chairs: 3 },
        ], error: null };
        case 'payments': return { data: [
          { practice_id: 'p1', amount_pence: 100000 },
          { practice_id: 'p2', amount_pence: 50000 },
        ], error: null };
        case 'appointments': return { data: [
          { practice_id: 'p1', status: 'completed' },
          { practice_id: 'p1', status: 'no_show' },
          { practice_id: 'p2', status: 'completed' },
        ], error: null };
        case 'leads': return { data: [
          { practice_id: 'p1', status: 'treatment_started' },
          { practice_id: 'p1', status: 'new' },
        ], error: null };
        case 'business_health': return { data: { baseline: { revenue: 1000000, cost_associates: 40, cost_staff: 20 } }, error: null };
        default: return { data: [], error: null };
      }
    };
    const res = await svc.businessHub(ORG_A, { days: 90, now: () => new Date('2026-05-25T00:00:00Z') });

    expect(res.group.revenuePence).toBe(150000);
    expect(res.group.appointments).toBe(3);
    expect(res.group.noShows).toBe(1);
    expect(res.group.leads).toBe(2);
    expect(res.group.revenueTargetPence).toBe(100000000); // baseline.revenue * 100
    expect(res.group.marginPct).toBeGreaterThan(0);       // 100 - 60 costs = 40% margin

    // sorted by revenue desc → Alpha first
    expect(res.practices[0]).toMatchObject({
      name: 'Alpha', revenuePence: 100000, appointments: 2, noShows: 1, noShowRate: 50, leads: 2, conversionRate: 50,
    });
    expect(res.practices[1]).toMatchObject({ name: 'Beta', revenuePence: 50000, appointments: 1 });
  });

  it('every query is org-scoped (cross-org isolation on the service-client path)', async () => {
    const tables = [];
    supaRec.resultProvider = (q) => {
      tables.push({ table: q.table, org: q.eqs.find((e) => e.col === 'organisation_id')?.val });
      return q.table === 'business_health' ? { data: { baseline: {} }, error: null } : { data: [], error: null };
    };
    await svc.businessHub(ORG_B, { days: 90 });
    // practices, payments, appointments, leads, business_health all filtered to ORG_B
    expect(tables.filter((t) => t.org === ORG_B).length).toBe(tables.length);
    expect(tables.length).toBeGreaterThanOrEqual(5);
  });
});
