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
  sumBucketsInWindow,
  monthlyFinancialService,
} = await import('../src/services/monthlyFinancial.service.js');
const repo = (await import('../src/repositories/monthlyFinancial.repository.js'))
  .monthlyFinancialRepository;
const svc = (await import('../src/services/analytics.service.js'))
  .analyticsService;

const ORG_A = 'org-aaaaaaaa';
const ORG_B = 'org-bbbbbbbb';
const orgFilter = (q) => q.eqs.find((e) => e.col === 'organisation_id');

// Stub the settled_receipts_by_day RPC with [{day, pence}] rows.
const rpcReceipts = (rows = []) => (fn) =>
  fn === 'settled_receipts_by_day' ? { data: rows, error: null } : { data: null, error: { message: `rpc ${fn} not stubbed` } };

beforeEach(() => {
  supaRec.last = undefined;
  supaRec.resultProvider = () => ({ data: [], error: null });
  supaRec.rpcProvider = () => ({ data: [], error: null });
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
  it('plInputFromBuckets: tax excluded, overhead+other → other, no property/marketing bucket', () => {
    const inp = plInputFromBuckets({
      revenue: 100000, staff: 30000, lab: 5000, materials: 3000,
      overhead: 8000, other: 2000, tax: 9999,
    });
    expect(inp).toEqual({
      revenue: 100000,
      costs: { associates: 0, staff: 30000, lab: 5000, materials: 3000, property: 0, marketing: 0, other: 10000 },
    });
  });

  it('plInputFromBuckets: associates bucket (clinician pay split from staff) flows to costs.associates', () => {
    const inp = plInputFromBuckets({ revenue: 100000, associates: 45000, staff: 18000 });
    expect(inp.costs.associates).toBe(45000);
    expect(inp.costs.staff).toBe(18000);
  });

  it('financeSeriesRowFromBuckets: groups + profit = revenue - all operating costs', () => {
    const row = financeSeriesRowFromBuckets('2026-03', {
      revenue: 100000, associates: 0, staff: 30000, lab: 5000, materials: 3000, overhead: 8000, other: 2000,
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
    q.table === 'monthly_financials' ? { data: rows, error: null }
      : q.table === 'bank_accounts' ? { data: [], error: null }
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
    // revenue and no costs ⇒ all-real ⇒ basis 'actuals'.
    expect(r.basis).toBe('actuals');
    expect(r.costsAvailable).toBe(true);
    const may = r.months.find((m) => m.month === '2026-05');
    expect(may.revenue).toBe(7_777_777); // xero, not manual 1
    expect(may.staffCosts).toBe(1_000_000);
    expect(may.profit).toBe(7_777_777 - 1_000_000);
    expect(may.costsAvailable).toBe(true);
  });

  it('real revenue from settled payments (exact RPC); costs & profit 0 (no cost source)', async () => {
    const now = () => new Date(2026, 4, 15);
    supaRec.resultProvider = (q) => (q.table === 'monthly_financials' ? { data: [], error: null } : { data: { baseline: { revenue: 1_200_000, cost_staff: 20 } }, error: null });
    supaRec.rpcProvider = rpcReceipts([
      { day: '2026-05-10', pence: 5_000_000 },
      { day: '2026-04-10', pence: 3_000_000 },
    ]);
    const r = await svc.financeSeries(ORG_A, { months: 12, now });
    expect(r.basis).toBe('revenue-only');
    expect(r.costsAvailable).toBe(false);
    expect(r.months).toHaveLength(12);
    const may = r.months.find((m) => m.month === '2026-05');
    expect(may.revenue).toBe(5_000_000); // exact real revenue
    expect(may.staffCosts).toBe(0); // no cost source → 0 (not a baseline estimate)
    expect(may.profit).toBe(0);
    expect(r.months.find((m) => m.month === '2026-04').revenue).toBe(3_000_000);
  });

  it('no actuals + no payments → 12 real zero months (basis=revenue-only)', async () => {
    const now = () => new Date(2026, 4, 15);
    supaRec.resultProvider = () => ({ data: [], error: null });
    supaRec.rpcProvider = rpcReceipts([]);
    const r = await svc.financeSeries(ORG_A, { months: 12, now });
    expect(r.basis).toBe('revenue-only');
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

describe('sumBucketsInWindow — period-sliced actuals', () => {
  const byPeriod = new Map([
    ['2025-12', { revenue: 1_000, staff: 100 }],
    ['2026-01', { revenue: 2_000, staff: 200, lab: 50 }],
    ['2026-02', { revenue: 3_000, staff: 300 }],
    ['2026-03', { revenue: 4_000, staff: 400 }],
  ]);

  it('sums only the periods the [from,to] day-range covers (month-inclusive)', () => {
    const out = sumBucketsInWindow(byPeriod, '2026-01-01', '2026-02-28');
    expect(out).toEqual({ revenue: 5_000, staff: 500, lab: 50 });
  });

  it('includes the endpoint months regardless of day-of-month', () => {
    const out = sumBucketsInWindow(byPeriod, '2026-01-15', '2026-03-10');
    expect(out).toEqual({ revenue: 9_000, staff: 900, lab: 50 });
  });

  it('accepts a plain object and returns {} when nothing falls in range', () => {
    expect(sumBucketsInWindow({ '2024-05': { revenue: 9 } }, '2026-01-01', '2026-03-31')).toEqual({});
  });
});

describe('dashboardSummary — net profit on a custom range (regression)', () => {
  // monthly_financials + bank + baseline; settled receipts RPC drives cash only.
  const withActualsAndRpc = (rows) => {
    supaRec.resultProvider = (q) =>
      q.table === 'monthly_financials' ? { data: rows, error: null }
        : q.table === 'bank_accounts' ? { data: [], error: null }
        : { data: { baseline: { revenue: 1_200_000 } }, error: null };
    // settled_receipts_by_day + treatment_revenue_matrix → empty (profit comes
    // from actuals, not these). Any unstubbed RPC returns [].
    supaRec.rpcProvider = () => ({ data: [], error: null });
  };

  it('slices actuals to the window so net profit is non-zero for a ranged request', async () => {
    withActualsAndRpc([
      { period: '2026-01', dental_bucket: 'revenue', amount_pence: 5_000_000, source: 'manual' },
      { period: '2026-01', dental_bucket: 'staff', amount_pence: 1_000_000, source: 'manual' },
      { period: '2026-02', dental_bucket: 'revenue', amount_pence: 5_000_000, source: 'manual' },
      { period: '2026-02', dental_bucket: 'staff', amount_pence: 1_000_000, source: 'manual' },
      // outside the window — must NOT be counted
      { period: '2025-06', dental_bucket: 'revenue', amount_pence: 9_000_000, source: 'manual' },
    ]);
    const r = await svc.dashboardSummary(ORG_A, { from: '2026-01-01', to: '2026-02-28' });
    expect(r.turnoverBasis).toBe('actuals');
    expect(r.revenuePence).toBe(10_000_000);   // 5m + 5m, 2025-06 excluded
    expect(r.totalCostsPence).toBe(2_000_000);  // 1m + 1m staff
    expect(r.netProfitPence).toBe(8_000_000);   // was 0 before the window-slice fix
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

// ============================================================================
// PostgREST's row ceiling. `.limit(5000)` does NOT lift it — the server
// truncates at its own db-max-rows and reports no error. Measured on the live
// database: an org holding 3,064 rows had exactly 1,000 returned, so two
// thirds of every cost silently vanished and August's cash out read £207,200
// against a true £299,071. Every finance surface fed by allForOrg — cashflow,
// runway, P&L, margin, benchmark — was wrong, by a different amount each
// month, because the read carried no ORDER BY either.
// ============================================================================
describe('monthly_financials reads page past the server row ceiling', () => {
  const row = (i) => ({
    id: i, period: '2026-08', account_code: `a${i}`, dental_bucket: 'overhead',
    amount_pence: 100, source: 'quickbooks', practice_id: null,
    integration_account_id: null, accounting_method: 'accrual',
  });
  // The harness serves one dataset through .range(), exactly as the server
  // does. The row TOTAL cannot tell a correct pager from one that stops on a
  // short page — with the harness slicing by .range(), both return every
  // row. Only the READ COUNT separates them: 1064 rows is 1000 + 64 + a
  // confirming empty read, where a `length < PAGE` reader stops after two.
  let reads = 0;
  const serve = (rows) => {
    reads = 0;
    supaRec.resultProvider = () => { reads += 1; return { data: rows, error: null }; };
  };

  beforeEach(() => { supaRec.last = undefined; });

  it('returns EVERY row when the ledger exceeds one page, not just the first', async () => {
    serve(Array.from({ length: 1064 }, (_, i) => row(i)));
    const out = await repo.allForOrg(ORG_A);
    // 1,064 — not the 1,000 the server hands back in one page.
    expect(out).toHaveLength(1064);
    expect(out.reduce((n, r) => n + r.amount_pence, 0)).toBe(106400);
    // 1000 + 64 + a confirming empty page. A `length < PAGE` reader would
    // stop after the 64-row page (2 reads) and still return all 1064 rows —
    // the row count alone cannot catch that regression.
    expect(reads).toBe(3);
  });

  it('reads a third, confirming EMPTY page rather than stopping on the short 64-row one', async () => {
    // The server's ceiling is its own setting: treating a short page as the
    // last would reintroduce this truncation at whatever that number is.
    serve(Array.from({ length: 700 }, (_, i) => row(i)));
    expect(await repo.allForOrg(ORG_A)).toHaveLength(700);
    // 700 < PAGE (1000), so a correct reader still takes a second, empty read
    // to confirm the ledger is exhausted. A `length < PAGE` reader stops
    // after just the first read and returns the same 700 rows.
    expect(reads).toBe(2);
  });

  it('orders the paged read, so OFFSET cannot repeat or skip a row', async () => {
    serve([]);
    await repo.allForOrg(ORG_A);
    expect(supaRec.last.orders?.some((o) => o.col === 'id')).toBe(true);
  });

  it('still scopes every page to the organisation', async () => {
    serve([row(1)]);
    await repo.allForOrg(ORG_B);
    expect(orgFilter(supaRec.last).val).toBe(ORG_B);
  });

  it('pages the owner-facing list too, ordered so paging is sound', async () => {
    serve(Array.from({ length: 1200 }, (_, i) => row(i)));
    const out = await repo.list(ORG_A, {});
    expect(out).toHaveLength(1200);
    expect(supaRec.last.orders?.some((o) => o.col === 'id')).toBe(true);
    // Same blind spot as allForOrg above: 1200 rows is indistinguishable
    // between a correct pager and a `length < PAGE` one by row count alone
    // (both return all 1200). 1000 + 200 + a confirming empty page = 3 reads;
    // a `length < PAGE` reader would stop after the 200-row page (2 reads).
    expect(reads).toBe(3);
  });
});
