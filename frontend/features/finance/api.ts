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
}

export async function getFinanceSeries(): Promise<{
  error?: string;
  months: FinanceMonth[];
}> {
  const r = await api('/api/analytics/finance-series?months=12');
  if (r?.error) return { error: r.error, months: [] };
  return {
    months: (r.months ?? []).map((m: any) => ({
      month: m.month,
      revenue: p(m.revenue),
      associate_pay: p(m.associatePay),
      staff_costs: p(m.staffCosts),
      lab_materials: p(m.labMaterials),
      opex: p(m.opex),
      profit: p(m.profit),
    })),
  };
}

export interface CashflowWeek {
  weekStartDate: string;
  opening: number;
  receipts: number;
  payments: number;
  closing: number;
  status: string;
}

export async function getCashflow(weeks = 13): Promise<{
  error?: string;
  bankConnected: boolean;
  bankStale: boolean;
  lastSyncedAt: string | null;
  weeks: CashflowWeek[];
}> {
  const r = await api(`/api/analytics/cashflow?weeks=${weeks}`);
  if (r?.error)
    return {
      error: r.error,
      bankConnected: false,
      bankStale: true,
      lastSyncedAt: null,
      weeks: [],
    };
  return {
    bankConnected: !!r.bankConnected,
    bankStale: !!r.bankStale,
    lastSyncedAt: r.lastSyncedAt ?? null,
    weeks: (r.weeks ?? []).map((w: any) => ({
      weekStartDate: w.weekStartDate,
      opening: p(w.opening),
      receipts: p(w.receipts),
      payments: p(w.payments),
      closing: p(w.closing),
      status: w.status,
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
): Promise<{
  error?: string;
  basis?: string;
  assumptions: { dsoDays: number; payableDays: number };
  ratios: FinancialRatio[];
  balanceSheet: Record<string, { value: number; estimated: boolean }>;
}> {
  const r = await api(
    `/api/analytics/financial?dsoDays=${dsoDays}&payableDays=${payableDays}`,
  );
  if (r?.error)
    return {
      error: r.error,
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
