import { api } from '@/lib/api';

// Backend returns integer pence; the dashboard UI/formatters work in whole
// pounds (matches the prototype's arithmetic). Convert at this boundary only.
export interface DashboardSummary {
  error?: string;
  basis?: string;
  turnoverBasis?: 'billed' | 'settled' | 'actuals';
  revenue: number;
  netProfit: number;
  margin: number; // percentage points
  totalCosts: number;
  cashCollected: number;
  monthsCovered: number;
  // The cash figures below are NULLABLE on purpose. Operating cashflow needs a
  // cost feed and the bank position needs an open-banking connection; when
  // either is absent the honest answer is "we don't know", not £0. A £0 on a
  // cash line reads as a real zero and is worse than a blank.
  cashflow: number | null;
  bankBalance: number | null;
  reserve: number | null;
  excessCash: number | null;
}

export interface SeriesMonth {
  month: string;
  revenue: number;
  profit: number;
  cash: number;
}

export interface PracticeRow {
  name: string;
  turnover: number;
  margin: number;
}

const p = (pence: number) => Math.round((pence || 0) / 100);
// Null-preserving variant — `p()` would collapse a null into a real-looking £0.
const pn = (pence: number | null | undefined) =>
  pence === null || pence === undefined ? null : Math.round(pence / 100);

export interface PeriodRange { from: string | null; to: string | null }
// from/to only take effect when BOTH are set (else default trailing window).
const rangeQS = (r?: PeriodRange | null) =>
  r && r.from && r.to ? `&from=${r.from}&to=${r.to}` : '';

const practiceQS = (id?: string | null) => (id ? `&practice_id=${id}` : '');

export async function getDashboardSummary(range?: PeriodRange, practiceId?: string | null): Promise<DashboardSummary> {
  const r = await api(`/api/analytics/dashboard-summary?months=12${rangeQS(range)}${practiceQS(practiceId)}`);
  if (r?.error) return { error: r.error } as DashboardSummary;
  return {
    basis: r.basis,
    turnoverBasis: r.turnoverBasis,
    revenue: p(r.revenuePence),
    netProfit: p(r.netProfitPence),
    margin: r.marginPct ?? 0,
    totalCosts: p(r.totalCostsPence),
    cashCollected: p(r.cashCollectedPence),
    monthsCovered: r.monthsCovered ?? 12,
    cashflow: pn(r.cashflowPence),
    bankBalance: pn(r.bankBalancePence),
    reserve: pn(r.reservePence),
    excessCash: pn(r.excessCashPence),
  };
}

export async function getRevenueSeries(range?: PeriodRange, practiceId?: string | null): Promise<{
  error?: string;
  basis?: string;
  months: SeriesMonth[];
}> {
  const r = await api(`/api/analytics/revenue-series?months=12${rangeQS(range)}${practiceQS(practiceId)}`);
  if (r?.error) return { error: r.error, months: [] };
  return {
    basis: r.basis,
    months: (r.months ?? []).map((m: any) => ({
      month: m.month,
      revenue: p(m.revenue),
      profit: p(m.profit),
      cash: p(m.cash),
    })),
  };
}

export async function getPracticeSummary(): Promise<{
  groupDerived: boolean;
  truncated: boolean;
  practices: PracticeRow[];
}> {
  const r = await api('/api/analytics/practice-summary');
  return {
    groupDerived: !!r?.groupDerived,
    truncated: !!r?.truncated,
    practices: (r?.practices ?? []).map((x: any) => ({
      name: x.name,
      turnover: p(x.turnoverPence),
      margin: x.marginPct ?? 0,
    })),
  };
}
