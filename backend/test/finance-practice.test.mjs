// Per-practice finance = actuals-only (monthly_financials filtered by
// practice_id). The org baseline is org-level and is NOT projected per practice.
import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const svc = (await import('../src/services/analytics.service.js')).analyticsService;
const ORG_A = 'org-aaaaaaaa';
const P1 = 'prac-11111111';
const P2 = 'prac-22222222';

beforeEach(() => {
  supaRec.last = undefined;
  supaRec.resultProvider = () => ({ data: [], error: null });
  supaRec.rpcProvider = () => ({ data: [], error: null }); // settled_receipts_by_day → empty
});

// monthly_financials rows for two practices + a baseline for the org.
const withRows = (rows) => (q) =>
  q.table === 'monthly_financials'
    ? { data: rows, error: null }
    : { data: { baseline: { revenue: 1_200_000, cost_staff: 18 } }, error: null };

const ROWS = [
  { period: '2026-01', dental_bucket: 'revenue', amount_pence: 5_000_000, source: 'manual', practice_id: P1 },
  { period: '2026-01', dental_bucket: 'staff', amount_pence: 1_000_000, source: 'manual', practice_id: P1 },
  { period: '2026-01', dental_bucket: 'revenue', amount_pence: 9_000_000, source: 'manual', practice_id: P2 },
];

describe('_actualsBundle — practice filter', () => {
  it('sums only the requested practice rows', async () => {
    supaRec.resultProvider = withRows(ROWS);
    const b = await svc._actualsBundle(ORG_A, P1);
    expect(b.annual.revenue).toBe(5_000_000);
    expect(b.annual.staff).toBe(1_000_000);
  });

  it('no practiceId => org-wide (all rows)', async () => {
    supaRec.resultProvider = withRows(ROWS);
    const b = await svc._actualsBundle(ORG_A);
    expect(b.annual.revenue).toBe(14_000_000);
  });
});

describe('pl — per practice = actuals only, no baseline projection', () => {
  it('returns the practice actuals (basis=actuals)', async () => {
    supaRec.resultProvider = withRows(ROWS);
    const r = await svc.pl(ORG_A, { practiceId: P1 });
    expect(r.basis).toBe('actuals');
    expect(r.revenue).toBe(5_000_000);
    expect(r.totalCosts).toBe(1_000_000);
  });

  it('practice with no actuals => error, never the org baseline', async () => {
    supaRec.resultProvider = withRows(ROWS);
    const r = await svc.pl(ORG_A, { practiceId: 'prac-empty' });
    expect(r).toEqual({ error: 'No data for this practice' });
  });
});

describe('financeSeries — per practice: real costs where present over the window', () => {
  it('puts the practice actual month in the 12-month window (basis=actuals)', async () => {
    const now = () => new Date(2026, 4, 15);
    supaRec.resultProvider = withRows(ROWS);
    const r = await svc.financeSeries(ORG_A, { months: 12, now, practiceId: P1 });
    expect(r.basis).toBe('actuals'); // costs from monthly_financials, no estimates
    expect(r.months).toHaveLength(12);
    const jan = r.months.find((m) => m.month === '2026-01');
    expect(jan).toMatchObject({ revenue: 5_000_000, staffCosts: 1_000_000, costsAvailable: true });
  });

  it('practice with no actuals/payments => 12 real zero months', async () => {
    const now = () => new Date(2026, 4, 15);
    supaRec.resultProvider = withRows(ROWS);
    const r = await svc.financeSeries(ORG_A, { months: 12, now, practiceId: 'prac-empty' });
    expect(r.basis).toBe('revenue-only');
    expect(r.months).toHaveLength(12);
    expect(r.months.every((m) => m.revenue === 0)).toBe(true);
  });
});

describe('financial — per practice margins from actuals', () => {
  it('computes margins from the practice actuals', async () => {
    supaRec.resultProvider = withRows([
      { period: '2026-01', dental_bucket: 'revenue', amount_pence: 10_000_000, source: 'manual', practice_id: P1 },
      { period: '2026-01', dental_bucket: 'lab', amount_pence: 2_000_000, source: 'manual', practice_id: P1 },
    ]);
    const r = await svc.financial(ORG_A, { dsoDays: 45, payableDays: 30, practiceId: P1 });
    expect(r.ratios.find((x) => x.key === 'grossMarginPct')).toMatchObject({ value: 80 });
  });

  it('practice with no actuals => error', async () => {
    supaRec.resultProvider = withRows(ROWS);
    const r = await svc.financial(ORG_A, { practiceId: 'prac-empty' });
    expect(r).toEqual({ error: 'No data for this practice' });
  });
});

describe('org-wide finance — real revenue, no projection', () => {
  it('financeSeries with no practiceId returns the real-revenue window', async () => {
    const now = () => new Date(2026, 4, 15);
    supaRec.resultProvider = (q) =>
      q.table === 'monthly_financials' ? { data: [], error: null }
      : q.table === 'payments' ? { data: [], error: null }
      : { data: { baseline: { revenue: 1_200_000, cost_staff: 18 } }, error: null };
    const r = await svc.financeSeries(ORG_A, { months: 12, now });
    expect(r.basis).toBe('revenue-only');
    expect(r.months).toHaveLength(12);
  });
});
