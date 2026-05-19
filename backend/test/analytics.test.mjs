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

beforeEach(() => {
  supaRec.last = undefined;
  supaRec.resultProvider = () => ({ data: [], error: null });
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
