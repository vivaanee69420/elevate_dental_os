// ============================================================================
// Monthly financials — manual P&L actuals: precedence helper, bucket→P&L
// mapping, repo org-scoping, and the analytics actuals read path (pl /
// financeSeries / financial surface actuals, Xero overrides manual).
// ============================================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const {
  bucketsByPeriod,
  plInputFromBuckets,
  financeSeriesRowFromBuckets,
  monthlyFinancialService,
} = await import('../src/services/monthlyFinancial.service.js');
const repo = (await import('../src/repositories/monthlyFinancial.repository.js'))
  .monthlyFinancialRepository;
const svc = (await import('../src/services/analytics.service.js'))
  .analyticsService;

const ORG_A = 'org-aaaaaaaa';
const ORG_B = 'org-bbbbbbbb';
const orgFilter = (q) => q.eqs.find((e) => e.col === 'organisation_id');

beforeEach(() => {
  supaRec.last = undefined;
  supaRec.resultProvider = () => ({ data: [], error: null });
});

describe('bucketsByPeriod — Xero overrides manual per period+bucket', () => {
  it('sums same-source rows; synced wins when both present for a bucket', () => {
    const rows = [
      { period: '2026-01', dental_bucket: 'revenue', amount_pence: 1000, source: 'manual' },
      { period: '2026-01', dental_bucket: 'revenue', amount_pence: 9000, source: 'xero' },
      { period: '2026-01', dental_bucket: 'staff', amount_pence: 500, source: 'manual' },
      { period: '2026-01', dental_bucket: 'staff', amount_pence: 200, source: 'manual' },
    ];
    const m = bucketsByPeriod(rows);
    // revenue: xero present → 9000 (manual 1000 ignored); staff: manual-only → 700
    expect(m.get('2026-01')).toEqual({ revenue: 9000, staff: 700 });
  });

  it('manual is the fallback when no synced row exists for that bucket', () => {
    const m = bucketsByPeriod([
      { period: '2026-02', dental_bucket: 'lab', amount_pence: 300, source: 'manual' },
    ]);
    expect(m.get('2026-02')).toEqual({ lab: 300 });
  });

  it('is array-safe (mock may hand back a non-array)', () => {
    expect(bucketsByPeriod({ baseline: {} }).size).toBe(0);
    expect(bucketsByPeriod(null).size).toBe(0);
  });
});

describe('bucket → P&L / finance-series mapping', () => {
  it('plInputFromBuckets: tax excluded, overhead+other → other, no associate/property/marketing bucket', () => {
    const inp = plInputFromBuckets({
      revenue: 100000, staff: 30000, lab: 5000, materials: 3000,
      overhead: 8000, other: 2000, tax: 9999,
    });
    expect(inp).toEqual({
      revenue: 100000,
      costs: { associates: 0, staff: 30000, lab: 5000, materials: 3000, property: 0, marketing: 0, other: 10000 },
    });
  });

  it('financeSeriesRowFromBuckets: groups + profit = revenue - all operating costs', () => {
    const row = financeSeriesRowFromBuckets('2026-03', {
      revenue: 100000, staff: 30000, lab: 5000, materials: 3000, overhead: 8000, other: 2000,
    });
    expect(row).toEqual({
      month: '2026-03',
      revenue: 100000,
      associatePay: 0,
      staffCosts: 30000,
      labMaterials: 8000,
      opex: 10000,
      profit: 52000,
    });
  });
});

describe('repository — tenant scoping on the service-client path', () => {
  it('allForOrg pins organisation_id, never a foreign org', async () => {
    await repo.allForOrg(ORG_A);
    expect(supaRec.last.table).toBe('monthly_financials');
    expect(orgFilter(supaRec.last)).toEqual({ col: 'organisation_id', val: ORG_A });
    expect(supaRec.last.eqs.some((e) => e.val === ORG_B)).toBe(false);
  });

  it('upsertManual forces source=manual + arbiter columns', async () => {
    const out = await repo.upsertManual(ORG_A, {
      period: '2026-01', dental_bucket: 'revenue', amount_pence: 5000,
    });
    expect(out).toMatchObject({ source: 'manual', account_code: 'revenue', period: '2026-01' });
    expect(supaRec.last.op).toBe('upsert');
    expect(supaRec.last.upsertVals).toMatchObject({
      organisation_id: ORG_A, period: '2026-01', dental_bucket: 'revenue',
      account_code: 'revenue', amount_pence: 5000, source: 'manual', practice_id: null,
    });
    expect(supaRec.last.upsertOpts.onConflict).toBe(
      'organisation_id,period,account_code,practice_id,source',
    );
  });

  it('remove only deletes manual rows for the caller org', async () => {
    await repo.remove(ORG_A, 'row-1');
    expect(supaRec.last.op).toBe('delete');
    expect(supaRec.last.eqs).toContainEqual({ col: 'organisation_id', val: ORG_A });
    expect(supaRec.last.eqs).toContainEqual({ col: 'source', val: 'manual' });
  });
});

describe('analytics read path — actuals surface on the finance screens', () => {
  // baseline + monthly_financials rows; synced (xero) overrides manual.
  const withActuals = (rows) => (q) =>
    q.table === 'monthly_financials'
      ? { data: rows, error: null }
      : { data: { baseline: { revenue: 1_200_000, profit: 300_000, cost_staff: 18 } }, error: null };

  it('pl uses actuals when present (basis=actuals)', async () => {
    supaRec.resultProvider = withActuals([
      { period: '2026-01', dental_bucket: 'revenue', amount_pence: 8_000_000, source: 'manual' },
      { period: '2026-01', dental_bucket: 'staff', amount_pence: 2_000_000, source: 'manual' },
    ]);
    const r = await svc.pl(ORG_A);
    expect(r.basis).toBe('actuals');
    expect(r.revenue).toBe(8_000_000);
    expect(r.totalCosts).toBe(2_000_000);
    expect(r.netProfit).toBe(6_000_000);
  });

  it('financeSeries uses monthly_financials costs where present (real, basis=actuals)', async () => {
    const now = () => new Date(2026, 4, 15); // months end 2026-05
    supaRec.resultProvider = withActuals([
      { period: '2026-05', dental_bucket: 'revenue', amount_pence: 7_777_777, source: 'xero' },
      { period: '2026-05', dental_bucket: 'staff', amount_pence: 1_000_000, source: 'xero' },
      // a manual row for the SAME period+bucket must be ignored (xero wins)
      { period: '2026-05', dental_bucket: 'revenue', amount_pence: 1, source: 'manual' },
    ]);
    const r = await svc.financeSeries(ORG_A, { months: 12, now });
    // Only May has real costs; other months have no payments → zero real
    // revenue and no estimated costs ⇒ all-real ⇒ basis 'actuals'.
    expect(r.basis).toBe('actuals');
    expect(r.costsEstimated).toBe(false);
    const may = r.months.find((m) => m.month === '2026-05');
    expect(may.revenue).toBe(7_777_777); // xero, not manual 1
    expect(may.staffCosts).toBe(1_000_000);
    expect(may.profit).toBe(7_777_777 - 1_000_000);
    expect(may.estimated).toBe(false);
  });

  it('real revenue from settled payments + baseline-estimated costs (basis=actuals-revenue)', async () => {
    const now = () => new Date(2026, 4, 15);
    supaRec.resultProvider = (q) => {
      if (q.table === 'monthly_financials') return { data: [], error: null };
      if (q.table === 'payments')
        return {
          data: [
            { amount_pence: 5_000_000, processed_at: '2026-05-10T00:00:00Z' },
            { amount_pence: 3_000_000, processed_at: '2026-04-10T00:00:00Z' },
          ],
          error: null,
        };
      return { data: { baseline: { revenue: 1_200_000, cost_staff: 20 } }, error: null };
    };
    const r = await svc.financeSeries(ORG_A, { months: 12, now });
    expect(r.basis).toBe('actuals-revenue');
    expect(r.costsEstimated).toBe(true);
    expect(r.months).toHaveLength(12);
    const may = r.months.find((m) => m.month === '2026-05');
    expect(may.revenue).toBe(5_000_000); // real from payments, not projected
    expect(may.staffCosts).toBe(1_000_000); // 20% of real revenue (baseline estimate)
    expect(may.estimated).toBe(true);
    expect(r.months.find((m) => m.month === '2026-04').revenue).toBe(3_000_000);
  });

  it('no actuals + no payments → 12 real zero months (basis=actuals-revenue)', async () => {
    const now = () => new Date(2026, 4, 15);
    supaRec.resultProvider = (q) =>
      q.table === 'monthly_financials' ? { data: [], error: null }
      : q.table === 'payments' ? { data: [], error: null }
      : { data: { baseline: { revenue: 1_200_000, cost_staff: 18 } }, error: null };
    const r = await svc.financeSeries(ORG_A, { months: 12, now });
    expect(r.basis).toBe('actuals-revenue');
    expect(r.months).toHaveLength(12);
    expect(r.months.every((m) => m.revenue === 0)).toBe(true);
  });

  it('financial computes margins from actuals when present', async () => {
    supaRec.resultProvider = withActuals([
      { period: '2026-01', dental_bucket: 'revenue', amount_pence: 10_000_000, source: 'xero' },
      { period: '2026-01', dental_bucket: 'lab', amount_pence: 2_000_000, source: 'xero' },
      { period: '2026-01', dental_bucket: 'staff', amount_pence: 3_000_000, source: 'xero' },
    ]);
    const r = await svc.financial(ORG_A, { dsoDays: 45, payableDays: 30 });
    // COGS = lab 2m (associates 0, materials 0) → gross 80%; total costs 5m → net 50%
    expect(r.ratios.find((x) => x.key === 'grossMarginPct')).toMatchObject({ value: 80, estimated: false });
    expect(r.ratios.find((x) => x.key === 'netMarginPct')).toMatchObject({ value: 50, estimated: false });
  });
});

describe('service createManual delegates to the repo', () => {
  it('passes the validated input through', async () => {
    const out = await monthlyFinancialService.createManual(ORG_A, {
      period: '2026-04', dental_bucket: 'materials', amount_pence: 1234,
    });
    expect(out).toMatchObject({ dental_bucket: 'materials', amount_pence: 1234, source: 'manual' });
    expect(supaRec.last.upsertVals).toMatchObject({ dental_bucket: 'materials', amount_pence: 1234 });
  });
});
