// Command Centre — client-side helpers ONLY. Despite the filename, nothing in
// here is mock DATA; it is the editable what-if P&L model plus pure
// formatters. (The synthetic dataset this file was named for was deleted.)
//
// All data now comes from real backend endpoints (see ./api.ts):
//   dashboard-summary, revenue-series, business-hub, /api/leads/funnel,
//   /api/health. The synthetic DATASET, fabricated PRACTICE_WEIGHTS and
//   per-practice financial generator were deleted — they invented numbers
//   with no real source. What remains here is genuinely client-side: the
//   editable P&L what-if model + pure formatters/labels.

// NOTE: the funnel STAGES list and the client-side `Lead` shape used to live
// here. Both are gone: stage ordering and the cumulative counts are now owned
// by the server (leadService.funnel), so there is exactly one definition of
// what the funnel means rather than one per screen.

export type PLLine = {
  id: string;
  label: string;
  pct: number;
  type: string;
  fixed?: boolean;
};
export type PLModel = {
  turnover: number;
  cogs: PLLine[];
  opex: PLLine[];
  targetMargin: number;
};

// Default editable P&L template. Seeded from the real baseline at the call
// site (DashboardScreen.seededPL); the model itself is a deliberate
// client-side what-if tool, not data.
export const DEFAULT_PL_TEMPLATE: PLModel = {
  turnover: 2000000,
  cogs: [
    { id: 'principal', label: 'Principal Fee / Associate fees', pct: 30.0, type: 'cogs' },
    { id: 'hygienist', label: 'Hygienist / Therapist', pct: 5.0, type: 'cogs' },
    { id: 'lab', label: 'Lab Fees', pct: 10.0, type: 'cogs' },
    { id: 'materials', label: 'Materials', pct: 5.4, type: 'cogs' },
  ],
  opex: [
    { id: 'marketing', label: 'Advertising & Marketing', pct: 10.0, type: 'opex', fixed: false },
    { id: 'bank', label: 'Bank Charges & Interest', pct: 0.1, type: 'opex', fixed: false },
    { id: 'rent', label: 'Business Rates & Rent', pct: 2.0, type: 'opex', fixed: true },
    { id: 'salaries', label: 'Salaries (Net + PAYE + NI + Pension) & Staff Costs', pct: 10.0, type: 'opex', fixed: true },
    { id: 'vouchers', label: 'Gift Vouchers', pct: 0.25, type: 'opex', fixed: false },
    { id: 'repairs', label: 'Repairs & Maintenance', pct: 0.25, type: 'opex', fixed: true },
    { id: 'leasing', label: 'Equipment Leasing / Finances', pct: 2.0, type: 'opex', fixed: true },
    { id: 'telephone', label: 'Telephone & WiFi', pct: 0.2, type: 'opex', fixed: true },
    { id: 'utilities', label: 'Utilities (Water, Gas, Electricity)', pct: 1.0, type: 'opex', fixed: true },
    { id: 'waste', label: 'Waste Collection / Clinical Waste', pct: 0.2, type: 'opex', fixed: true },
    { id: 'insurance', label: 'Insurance', pct: 0.2, type: 'opex', fixed: true },
    { id: 'profFees', label: 'Professional Fees', pct: 0.08, type: 'opex', fixed: true },
    { id: 'sundry', label: 'Sundry Expenses (Post, Travel etc)', pct: 0.2, type: 'opex', fixed: false },
    { id: 'printing', label: 'Printing / Stationery', pct: 0.25, type: 'opex', fixed: false },
    { id: 'subscriptions', label: 'Subscriptions', pct: 0.05, type: 'opex', fixed: true },
    { id: 'it', label: 'IT Expenses', pct: 0.5, type: 'opex', fixed: true },
    { id: 'cleaning', label: 'Cleaning', pct: 0.4, type: 'opex', fixed: true },
    { id: 'misc', label: 'Other Miscellaneous Expenses', pct: 0.05, type: 'opex', fixed: false },
  ],
  targetMargin: 25.0,
};

export type PLCalc = {
  turnover: number;
  netProfit: number;
  netMarginActual: number;
  variablePct: number;
  fixedAtCurrent: number;
  breakeven: number;
  contributionMargin: number;
  revAtTarget: number | null;
  targetProfit: number;
  profitGap: number;
};

// Pure break-even / target model over the editable P&L. Client-side only.
export function calcPL(m: PLModel): PLCalc {
  const T = m.turnover;
  const cogsTotal = m.cogs.reduce((s, l) => s + (T * l.pct) / 100, 0);
  const grossProfit = T - cogsTotal;
  const opexTotal = m.opex.reduce((s, l) => s + (T * l.pct) / 100, 0);
  const netProfit = grossProfit - opexTotal;
  const netMarginActual = T ? (netProfit / T) * 100 : 0;
  const variablePct =
    (m.cogs.reduce((s, l) => s + l.pct, 0) +
      m.opex.filter((l) => !l.fixed).reduce((s, l) => s + l.pct, 0)) /
    100;
  const fixedAtCurrent = m.opex
    .filter((l) => l.fixed)
    .reduce((s, l) => s + (T * l.pct) / 100, 0);
  const breakeven = 1 - variablePct > 0 ? fixedAtCurrent / (1 - variablePct) : 0;
  const contributionMargin = (1 - variablePct) * 100;
  const target = m.targetMargin / 100;
  const denom = 1 - variablePct - target;
  const revAtTarget = denom > 0 ? fixedAtCurrent / denom : null;
  const targetProfit = T * target;
  const profitGap = targetProfit - netProfit;

  return {
    turnover: T,
    netProfit,
    netMarginActual,
    variablePct,
    fixedAtCurrent,
    breakeven,
    contributionMargin,
    revAtTarget,
    targetProfit,
    profitGap,
  };
}

export type DateRange = 'mtd' | 'qtd' | '6m' | 'ytd';

export function rangeLabel(r: DateRange): string {
  // Labels must match the to-date windows in rangeToDates (period start -> now),
  // NOT trailing periods. YTD = Jan 1 -> now, so "Year to date", not "Last 12
  // months" (which would be a 12-month trailing window the dashboard never uses).
  return (
    {
      mtd: 'Month to date',
      qtd: 'Quarter to date',
      ytd: 'Year to date',
      '6m': 'Last 6 months',
    } as Record<DateRange, string>
  )[r] || 'Year to date';
}

// Compact pound formatter (£1.2m / £45k).
export function ccPounds(n: number): string {
  if (n === null || n === undefined || isNaN(n)) return '£0';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_000_000) return sign + '£' + (abs / 1_000_000).toFixed(2) + 'm';
  if (abs >= 1000) return sign + '£' + Math.round(abs / 1000) + 'k';
  return sign + '£' + Math.round(abs).toLocaleString('en-GB');
}

// Full pound formatter.
export function ccPoundsFull(n: number): string {
  if (n === null || n === undefined || isNaN(n)) return '£0';
  return (
    (n < 0 ? '-' : '') + '£' + Math.abs(Math.round(n)).toLocaleString('en-GB')
  );
}
