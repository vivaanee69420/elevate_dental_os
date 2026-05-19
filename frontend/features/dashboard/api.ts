import { api } from '@/lib/api';

// Backend returns integer pence; the dashboard UI/formatters work in whole
// pounds (matches the prototype's arithmetic). Convert at this boundary only.
export interface DashboardSummary {
  error?: string;
  basis?: string;
  revenue: number;
  netProfit: number;
  margin: number; // percentage points
  totalCosts: number;
  cashCollected: number;
  cashflow: number;
  reserve: number;
  excessCash: number;
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

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const r = await api('/api/analytics/dashboard-summary');
  if (r?.error) return { error: r.error } as DashboardSummary;
  return {
    basis: r.basis,
    revenue: p(r.revenuePence),
    netProfit: p(r.netProfitPence),
    margin: r.marginPct ?? 0,
    totalCosts: p(r.totalCostsPence),
    cashCollected: p(r.cashCollectedPence),
    cashflow: p(r.cashflowPence),
    reserve: p(r.reservePence),
    excessCash: p(r.excessCashPence),
  };
}

export async function getRevenueSeries(): Promise<{
  error?: string;
  basis?: string;
  months: SeriesMonth[];
}> {
  const r = await api('/api/analytics/revenue-series?months=12');
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
