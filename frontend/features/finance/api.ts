import { api } from '@/lib/api';

// Backend returns integer pence; the finance screens work in whole pounds
// (matches the prototype arithmetic + ../mock formatters). Convert here only.
const p = (pence: number) => Math.round((pence || 0) / 100);
// Null-preserving. `p` turns null into 0, which is right for a genuine zero and
// WRONG for an unknowable figure — a cash position that does not exist at this
// scope must reach the UI as null so it renders an em dash, not a confident £0.
const pn = (pence: number | null | undefined) =>
  pence == null ? null : Math.round(pence / 100);

export interface DateRange { from: string | null; to: string | null }

/** Cash vs accrual cost base. The cashflow views default to CASH. */
export type CostBasis = 'cash' | 'accrual';
// from/to only take effect when BOTH are set (backend overrides its rolling
// window only then); otherwise an empty string → default window.
const rangeQS = (r?: DateRange | null) =>
  r && r.from && r.to ? `&from=${r.from}&to=${r.to}` : '';

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

// /profit data-source toggle. 'combined' = Dentally revenue + all-source costs
// (the original behaviour); 'dentally' = revenue only, £0 costs; 'quickbooks' =
// full P&L (revenue + costs) from connected QuickBooks companies only.
export type FinanceSource = 'combined' | 'dentally' | 'quickbooks';

// QuickBooks-parity matrix options: report-window length + accounting basis.
export interface FinanceSeriesOpts {
  months?: number;                       // default 12 (max 24, backend-capped)
  accountingMethod?: 'accrual' | 'cash'; // default accrual
}

export async function getFinanceSeries(
  practiceId?: string | null,
  range?: DateRange | null,
  source: FinanceSource = 'combined',
  accountId?: string | null,
  opts?: FinanceSeriesOpts,
): Promise<{
  error?: string;
  basis?: 'actuals' | 'mixed' | 'revenue-only';
  costsAvailable: boolean;
  source?: FinanceSource;
  months: FinanceMonth[];
}> {
  // QuickBooks is scoped by company (accountId), not practice — drop practice_id.
  const months = opts?.months ?? 12;
  const pp = source !== 'quickbooks' && practiceId ? `&practice_id=${practiceId}` : '';
  const sp = source !== 'combined' ? `&source=${source}` : '';
  const ap = source === 'quickbooks' && accountId ? `&account_id=${accountId}` : '';
  const am = `&accounting_method=${opts?.accountingMethod ?? 'accrual'}`;
  const r = await api(`/api/analytics/finance-series?months=${months}${pp}${sp}${ap}${am}${rangeQS(range)}`);
  if (r?.error) return { error: r.error, costsAvailable: false, months: [] };
  return {
    basis: r.basis,
    source: r.source,
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

// One week of money in. There is deliberately NO balance here: no tenant has a
// per-week outflow feed (bank_transactions is empty everywhere and nothing
// reads it), so a weekly bank balance cannot be computed and must not be shown.
// `cumulativeReceipts` is a running total of `receipts` — it starts at zero, not
// at the bank balance.
export interface CashflowWeek {
  weekStartDate: string;
  receipts: number;
  cumulativeReceipts: number;
}

// Cash runway derived from the real bank balance + P&L cost base (FORMULAS §14).
// All money in pounds (converted from the pence the backend returns). runwayMonths
// is null when cash-positive (no finite runway — not a missing value).
export interface CashRunway {
  // null when there is no cash-on-hand figure at this scope (a practice: the
  // bank balance is the organisation's and cannot be split).
  freeCash: number | null;
  monthlyReceipts: number;
  monthlyCosts: number;
  monthlyNet: number;
  monthlyBurn: number;
  runwayMonths: number | null;
  cashPositive: boolean;
  status: 'healthy' | 'warning' | 'critical';
  costsAvailable: boolean;
  costsBasis: 'actuals' | 'baseline' | 'none';
  bankAttributable: boolean;
}

// Real backward 13-week cash view: each week = settled payments received that
// week (no projection). baselineWeeklyRunRate is a comparison target only.
export async function getCashflow(
  weeks = 13,
  practiceId?: string | null,
  range?: DateRange | null,
  basis: CostBasis = 'cash',
): Promise<{
  bankConnected: boolean;
  bankStale: boolean;
  lastSyncedAt: string | null;
  bankBalance: number;
  bankSource: string | null;
  totalReceipts: number;
  weeks: CashflowWeek[];
  runway: CashRunway | null;
}> {
  const pp = practiceId ? `&practice_id=${practiceId}` : '';
  const r = await api(`/api/analytics/cashflow?weeks=${weeks}${pp}${rangeQS(range)}&accounting_method=${basis}`);
  const rw = r.runway;
  return {
    bankConnected: !!r.bankConnected,
    bankStale: !!r.bankStale,
    lastSyncedAt: r.lastSyncedAt ?? null,
    bankBalance: p(r.bankBalancePence),
    bankSource: r.bankSource ?? null,
    totalReceipts: p(r.totalReceiptsPence),
    weeks: (r.weeks ?? []).map((w: any) => ({
      weekStartDate: w.weekStartDate,
      receipts: p(w.receiptsPence),
      cumulativeReceipts: p(w.cumulativeReceiptsPence),
    })),
    runway: rw
      ? {
          freeCash: pn(rw.freeCashPence),
          monthlyReceipts: p(rw.monthlyReceiptsPence),
          monthlyCosts: p(rw.monthlyCostsPence),
          monthlyNet: p(rw.monthlyNetPence),
          monthlyBurn: p(rw.monthlyBurnPence),
          runwayMonths: rw.runwayMonths ?? null,
          cashPositive: !!rw.cashPositive,
          status: rw.status ?? 'healthy',
          costsAvailable: !!rw.costsAvailable,
          costsBasis: rw.costsBasis ?? 'none',
          bankAttributable: rw.bankAttributable !== false,
        }
      : null,
  };
}

// --- Cashflow & Runway outlook (forward projection + bills + decision) -------
export interface OutlookMonth {
  month: string;
  in: number;
  out: number;
  net: number;
  // null on a practice scope: the bank balance is org-level, so there is no
  // balance trail to open or close a practice's month with.
  opening: number | null;
  closing: number | null;
  costsAvailable: boolean;
  /**
   * True while this month is still running: some costs have posted, but not
   * the ones that land late (payroll, rent, lab bills). Its Out and Net are
   * "so far", never the month's trading.
   */
  costsPartial: boolean;
  projected: boolean;
  /**
   * Where this month's cash-in figure came from. 'settled' has landed in the
   * bank; 'billed' is accrual turnover used only where a month has no settled
   * receipts at all; 'forecast' has not happened.
   */
  inBasis: 'settled' | 'billed' | 'forecast' | 'none';
}
export interface OutlookBill {
  item: string;
  type: string;
  window: string;
  amount: number;
  estimated: boolean;
}
export interface CashflowOutlook {
  basis: string;
  bankConnected: boolean;
  anchorBank: number;
  costsAvailable: boolean;
costsBasis: 'actuals' | 'baseline' | 'none';
  /**
   * Why cash out is missing, so the UI does not tell an owner to connect a feed
   * they have. 'org-level-costs' is by design: a QuickBooks company is never
   * mapped to a practice, so costs live only at org level.
   */
  costsUnavailableReason: 'no-feed' | 'org-level-costs' | 'no-rows' | null;
  /** Which basis these cost figures are actually on. Null when there is no feed. */
  costsAccountingBasis: CostBasis | null;
  costsBasisRequested: CostBasis;
  /** True when the requested basis had no rows and the other one is on screen. */
  costsBasisFellBack: boolean;
  inSource: string | null;  // settled-cash feed (e.g. 'Dentally'); null when no month is cash
  inFallbackSource: string | null; // feed behind any BILLED month
  outSource: string | null; // feed behind cash-out (e.g. 'QuickBooks')
  bankSource: string | null; // where the balance itself comes from
  balancesReconstructed: boolean;
  /** The bank position is the ORGANISATION's; false when a practice is selected. */
  bankAttributable: boolean;
  bankUnavailableReason: 'org-level-bank' | null;
  /**
   * Whether a closing-balance trail could be built. The trail is anchored to
   * TODAY's bank balance, so it needs both an org scope and a window that ends
   * in the current month.
   */
  balancesAvailable: boolean;
  balancesUnavailableReason: 'org-level-bank' | 'past-window' | null;
  months: OutlookMonth[];
  /**
   * The CHART's series: complete months trailing today, independent of the date
   * filter. `months` follows the picker and is usually one month, which is not
   * a trend.
   */
  trend: OutlookMonth[];
  currentIndex: number;
  /** Lowest FORECAST closing balance — null when nothing has been forecast. */
  lowestProjected: number | null;
  /** Lowest closing balance across the months on screen. Context, not a constraint. */
  lowestInWindow: number | null;
  runway: CashRunway;
  bills: OutlookBill[];
  billsBasis: string;
  billsNote: string;
  decision: {
    // All null when the cash position is not attributable to this scope.
    buffer: number | null;
    freeCash: number | null;
    sweepable: number | null;
    lowClearsBuffer: boolean;
    action: 'build_buffer' | 'sweep' | 'hold' | 'unavailable';
  };
}

export async function getCashflowOutlook(
  months = 4,
  forward = 2,
  practiceId?: string | null,
  range?: DateRange | null,
  basis: CostBasis = 'cash',
): Promise<CashflowOutlook> {
  const pp = practiceId ? `&practice_id=${practiceId}` : '';
  const r = await api(
    `/api/analytics/cashflow-outlook?months=${months}&forward=${forward}${pp}${rangeQS(range)}&accounting_method=${basis}`,
  );
  const d = r.decision ?? {};
  return {
    basis: r.basis ?? 'revenue-only',
    bankConnected: !!r.bankConnected,
    anchorBank: p(r.anchorBankPence),
    costsAvailable: !!r.costsAvailable,
    costsBasis: r.costsBasis ?? 'none',
    costsUnavailableReason: r.costsUnavailableReason ?? null,
    costsAccountingBasis: r.costsAccountingBasis ?? null,
    costsBasisRequested: r.costsBasisRequested ?? 'cash',
    costsBasisFellBack: !!r.costsBasisFellBack,
    inSource: r.inSource ?? null,
    inFallbackSource: r.inFallbackSource ?? null,
    outSource: r.outSource ?? null,
    bankSource: r.bankSource ?? null,
    balancesReconstructed: !!r.balancesReconstructed,
    months: (r.months ?? []).map((m: any) => ({
      month: m.month,
      in: p(m.inPence),
      out: p(m.outPence),
      net: p(m.netPence),
      opening: pn(m.openingPence),
      closing: pn(m.closingPence),
      costsAvailable: !!m.costsAvailable,
      costsPartial: !!m.costsPartial,
      projected: !!m.projected,
      inBasis: m.inBasis ?? 'none',
    })),
    trend: (r.trend ?? []).map((m: any) => ({
      month: m.month,
      in: p(m.inPence),
      out: p(m.outPence),
      net: p(m.inPence) - p(m.outPence),
      opening: null,
      closing: null,
      costsAvailable: !!m.costsAvailable,
      costsPartial: !!m.costsPartial,
      projected: !!m.projected,
      inBasis: m.inBasis ?? 'none',
    })),
    bankAttributable: r.bankAttributable !== false,
    bankUnavailableReason: r.bankUnavailableReason ?? null,
    balancesAvailable: r.balancesAvailable !== false,
    balancesUnavailableReason: r.balancesUnavailableReason ?? null,
    currentIndex: r.currentIndex ?? -1,
    lowestProjected: pn(r.lowestProjectedPence),
    lowestInWindow: pn(r.lowestInWindowPence),
    runway: {
      freeCash: pn(r.runway?.freeCashPence),
      monthlyReceipts: p(r.runway?.monthlyReceiptsPence),
      monthlyCosts: p(r.runway?.monthlyCostsPence),
      monthlyNet: p(r.runway?.monthlyNetPence),
      monthlyBurn: p(r.runway?.monthlyBurnPence),
      runwayMonths: r.runway?.runwayMonths ?? null,
      cashPositive: !!r.runway?.cashPositive,
      status: r.runway?.status ?? 'healthy',
      costsAvailable: !!r.runway?.costsAvailable,
      costsBasis: r.runway?.costsBasis ?? 'none',
      bankAttributable: r.runway?.bankAttributable !== false,
    },
    bills: (r.bills ?? []).map((b: any) => ({
      item: b.item,
      type: b.type,
      window: b.window,
      amount: p(b.amountPence),
      estimated: !!b.estimated,
    })),
    billsBasis: r.billsBasis ?? 'none',
    billsNote: r.billsNote ?? '',
    decision: {
      buffer: pn(d.bufferPence),
      freeCash: pn(d.freeCashPence),
      sweepable: pn(d.sweepablePence),
      lowClearsBuffer: !!d.lowClearsBuffer,
      action: d.action ?? 'hold',
    },
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
  range?: DateRange | null,
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
    `/api/analytics/financial?dsoDays=${dsoDays}&payableDays=${payableDays}${pp}${rangeQS(range)}`,
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

// --- Profit Benchmarking (Intelligence OS — CoA→P&L) ------------------------
// Actual cost/profit ratios vs the UK dental group benchmarks (45/18/15/12/10).
// Real monthly_financials actuals only — costsAvailable:false when there is no
// real cost source (never a baseline estimate on a Finance screen). £ in pounds.
export interface BenchmarkRow {
  key: string;
  label: string;
  benchmarkPct: number;
  benchmark: number; // pounds
  actual: number; // pounds
  actualPct: number;
  variancePts: number;
  good: boolean;
  severity: 'good' | 'bad' | 'neutral';
  verdict: string;
}
export interface ProfitBenchmark {
  costsAvailable: boolean;
  basis: 'actuals' | 'none';
  periodsCovered: number;
  revenue: number; // pounds
  marginPct: number;
  overspend: number; // pounds — recoverable to benchmark
  dentistStaffSeparable: boolean;
  rows: BenchmarkRow[];
}

export async function getProfitBenchmark(
  practiceId?: string | null,
  source: FinanceSource = 'combined',
  accountId?: string | null,
  range?: DateRange | null,
): Promise<ProfitBenchmark> {
  const qs = new URLSearchParams();
  // QuickBooks is scoped by company, not practice — drop practice_id.
  if (source !== 'quickbooks' && practiceId) qs.set('practice_id', practiceId);
  if (source !== 'combined') qs.set('source', source);
  if (source === 'quickbooks' && accountId) qs.set('account_id', accountId);
  // from/to take effect only when BOTH set (else the trailing-12mo window).
  if (range?.from && range?.to) { qs.set('from', range.from); qs.set('to', range.to); }
  const q = qs.toString();
  const r = await api(`/api/analytics/pl-benchmark${q ? `?${q}` : ''}`);
  return {
    costsAvailable: !!r.costsAvailable,
    basis: r.basis ?? 'none',
    periodsCovered: r.periodsCovered ?? 0,
    revenue: p(r.revenue),
    marginPct: r.marginPct ?? 0,
    overspend: p(r.overspendPence),
    dentistStaffSeparable: r.dentistStaffSeparable !== false,
    rows: (r.rows ?? []).map((row: any) => ({
      key: row.key,
      label: row.label,
      benchmarkPct: row.benchmarkPct,
      benchmark: p(row.benchmarkPence),
      actual: p(row.actualPence),
      actualPct: row.actualPct,
      variancePts: row.variancePts,
      good: !!row.good,
      severity: row.severity ?? 'neutral',
      verdict: row.verdict ?? '',
    })),
  };
}
