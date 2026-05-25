import { api } from '@/lib/api';

// Backend returns integer pence; the finance screens work in whole pounds
// (matches the prototype arithmetic + ../mock formatters). Convert here only.
const p = (pence: number) => Math.round((pence || 0) / 100);

export interface FinanceMonth {
  month: string;
  revenue: number;
  associate_pay: number;
  staff_costs: number;
  lab_materials: number;
  opex: number;
  profit: number;
  costsAvailable: boolean; // true only when this month's costs are real (Xero/manual)
}

export async function getFinanceSeries(practiceId?: string | null): Promise<{
  error?: string;
  basis?: 'actuals' | 'mixed' | 'revenue-only';
  costsAvailable: boolean;
  months: FinanceMonth[];
}> {
  const pp = practiceId ? `&practice_id=${practiceId}` : '';
  const r = await api(`/api/analytics/finance-series?months=12${pp}`);
  if (r?.error) return { error: r.error, costsAvailable: false, months: [] };
  return {
    basis: r.basis,
    costsAvailable: !!r.costsAvailable,
    months: (r.months ?? []).map((m: any) => ({
      month: m.month,
      revenue: p(m.revenue),
      associate_pay: p(m.associatePay),
      staff_costs: p(m.staffCosts),
      lab_materials: p(m.labMaterials),
      opex: p(m.opex),
      profit: p(m.profit),
      costsAvailable: !!m.costsAvailable,
    })),
  };
}

export interface CashflowWeek {
  weekStartDate: string;
  opening: number;
  receipts: number;
  closing: number;
}

// Real backward 13-week cash view: each week = settled payments received that
// week (no projection). baselineWeeklyRunRate is a comparison target only.
export async function getCashflow(weeks = 13, practiceId?: string | null): Promise<{
  bankConnected: boolean;
  bankStale: boolean;
  lastSyncedAt: string | null;
  openingBalance: number;
  totalReceipts: number;
  weeks: CashflowWeek[];
}> {
  const pp = practiceId ? `&practice_id=${practiceId}` : '';
  const r = await api(`/api/analytics/cashflow?weeks=${weeks}${pp}`);
  return {
    bankConnected: !!r.bankConnected,
    bankStale: !!r.bankStale,
    lastSyncedAt: r.lastSyncedAt ?? null,
    openingBalance: p(r.openingBalancePence),
    totalReceipts: p(r.totalReceiptsPence),
    weeks: (r.weeks ?? []).map((w: any) => ({
      weekStartDate: w.weekStartDate,
      opening: p(w.openingBalancePence),
      receipts: p(w.receiptsPence),
      closing: p(w.closingBalancePence),
    })),
  };
}

export interface FinancialRatio {
  key: string;
  value: number;
  estimated: boolean;
  light: string;
}

export async function getFinancial(
  dsoDays = 45,
  payableDays = 30,
  practiceId?: string | null,
): Promise<{
  error?: string;
  basis?: string;
  costsAvailable: boolean;
  revenue: number;
  assumptions: { dsoDays: number; payableDays: number };
  ratios: FinancialRatio[];
  balanceSheet: Record<string, { value: number; estimated: boolean }>;
}> {
  const pp = practiceId ? `&practice_id=${practiceId}` : '';
  const r = await api(
    `/api/analytics/financial?dsoDays=${dsoDays}&payableDays=${payableDays}${pp}`,
  );
  if (r?.error)
    return {
      error: r.error,
      costsAvailable: false,
      revenue: 0,
      assumptions: { dsoDays, payableDays },
      ratios: [],
      balanceSheet: {},
    };
  // Money fields are pence on the wire; convert balance-sheet values to £.
  const bs: Record<string, { value: number; estimated: boolean }> = {};
  for (const [k, v] of Object.entries(r.balanceSheet ?? {})) {
    const cell = v as { value: number; estimated: boolean };
    bs[k] = { value: p(cell.value), estimated: cell.estimated };
  }
  return {
    basis: r.basis,
    costsAvailable: !!r.costsAvailable,
    revenue: p(r.revenuePence),
    assumptions: r.assumptions ?? { dsoDays, payableDays },
    ratios: r.ratios ?? [],
    balanceSheet: bs,
  };
}

// Valuation base (TTM revenue + reported EBITDA) from the real finance-series.
// The interactive valuation engine (regions/DSO/sensitivity) stays client-side
// in ../mock and is fed this base; backend /api/analytics/valuation is the
// degraded fallback when this errors / no baseline.
export async function getValuationBase(): Promise<{
  error?: string;
  ttmRevenue: number;
  reportedEbitda: number;
}> {
  const r = await api('/api/analytics/finance-series?months=12');
  if (r?.error) return { error: r.error, ttmRevenue: 0, reportedEbitda: 0 };
  const months = r.months ?? [];
  const ttmRevenuePence = months.reduce(
    (s: number, m: any) => s + (m.revenue || 0),
    0,
  );
  const ttmProfitPence = months.reduce(
    (s: number, m: any) => s + (m.profit || 0),
    0,
  );
  // Reported EBITDA ≈ net profit + ~4% revenue add-back (D&A + interest),
  // same convention as the prototype valuationBase().
  const reportedEbitdaPence =
    ttmProfitPence + Math.round(ttmRevenuePence * 0.04);
  return {
    ttmRevenue: p(ttmRevenuePence),
    reportedEbitda: p(reportedEbitdaPence),
  };
}

export async function getValuationFallback(): Promise<any> {
  return api('/api/analytics/valuation');
}

// --- Source breakdown (where the money came from) ---------------------------
// Returns counts + pence per source over last N days. Drives provenance widget.
export interface SourceBreakdown {
  [source: string]: { count: number; pence: number };
}

export async function getPaymentSourceBreakdown(days = 30): Promise<SourceBreakdown> {
  return api<SourceBreakdown>(`/api/payments/source-breakdown?days=${days}`);
}

// --- Manual payment entry ---------------------------------------------------
// POST /api/payments — owner records payments that didn't come through any
// connected app. source='manual' set server-side.
export interface ManualPaymentInput {
  practice_id: string;
  contact_id?: string;
  lead_id?: string;
  amount_pence: number;
  method?: 'card' | 'apple_pay' | 'google_pay' | 'bank_transfer' | 'cash' | 'direct_debit' | 'finance' | 'card_on_file' | 'pay_link';
  status?: 'pending' | 'processing' | 'settled' | 'failed' | 'refunded' | 'disputed';
  description?: string;
  processed_at?: string;
}

export async function recordManualPayment(input: ManualPaymentInput) {
  return api('/api/payments', { method: 'POST', body: JSON.stringify(input) });
}

// --- Manual P&L actuals (monthly_financials) --------------------------------
// POST /api/monthly-financials — owner enters real P&L line items per period +
// bucket. source='manual' set server-side. These surface on /profit + /financial
// (Xero overrides manual for the same period+bucket; manual is the fallback).
export type DentalBucket =
  | 'revenue' | 'staff' | 'lab' | 'materials' | 'overhead' | 'tax' | 'other';

export const DENTAL_BUCKET_LABELS: Record<DentalBucket, string> = {
  revenue: 'Revenue',
  staff: 'Staff costs',
  lab: 'Lab',
  materials: 'Materials',
  overhead: 'Overhead',
  tax: 'Tax',
  other: 'Other',
};

export interface MonthlyFinancialInput {
  period: string; // YYYY-MM
  dental_bucket: DentalBucket;
  amount_pence: number;
  account_code?: string;
  practice_id?: string | null;
}

export interface MonthlyFinancialRow {
  id: string;
  period: string;
  account_code: string;
  dental_bucket: DentalBucket;
  amount_pence: number;
  practice_id: string | null;
  source: 'manual' | 'xero' | 'quickbooks';
  updated_at: string;
}

export async function recordMonthlyFinancial(input: MonthlyFinancialInput) {
  return api('/api/monthly-financials', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function listMonthlyFinancials(params?: {
  from?: string;
  to?: string;
  practice_id?: string | null;
}): Promise<{ rows: MonthlyFinancialRow[] }> {
  const qs = new URLSearchParams();
  if (params?.from) qs.set('from', params.from);
  if (params?.to) qs.set('to', params.to);
  if (params?.practice_id) qs.set('practice_id', params.practice_id);
  const q = qs.toString();
  return api(`/api/monthly-financials${q ? `?${q}` : ''}`);
}

export async function deleteMonthlyFinancial(id: string) {
  return api(`/api/monthly-financials/${id}`, { method: 'DELETE' });
}
