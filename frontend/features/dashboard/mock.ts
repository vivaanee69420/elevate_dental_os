// Command Centre mock-data layer.
//
// Mirrors the client-side computation in preview/elevate-dental-os-v2.html
// (PAGES.dashboard override, ~line 12357) so the page can render pixel-exact
// today. The backend /api/analytics/dashboard endpoint only returns a single
// health baseline; per-practice financials, monthly series, and the editable
// P&L model do not exist server-side yet. When those endpoints land, swap the
// data source here — the component contract (DashboardData) stays the same.
//
// NOTE: this layer works in whole pounds to match the prototype's arithmetic.
// The real backend uses integer pence (lib/formulas.js); conversion happens at
// the swap point, not here.

export const PRACTICES = [
  'Ashford Dental',
  'Rochester Dental',
  'Barnet Dental',
  'Warwick Lodge Implant Centre',
  'Fixed Teeth Solutions Bexleyheath',
] as const;

export const TARGET_PROFIT_PCT = 0.25; // 25% target

type Weight = { rev: number; profitPct: number; cashConvPct: number; opExPct: number };

export const PRACTICE_WEIGHTS: Record<string, Weight> = {
  'All practices': { rev: 1.0, profitPct: 0.235, cashConvPct: 0.94, opExPct: 0.66 },
  'Warwick Lodge Implant Centre': { rev: 0.32, profitPct: 0.28, cashConvPct: 0.95, opExPct: 0.62 },
  'Ashford Dental': { rev: 0.2, profitPct: 0.21, cashConvPct: 0.93, opExPct: 0.67 },
  'Rochester Dental': { rev: 0.18, profitPct: 0.2, cashConvPct: 0.92, opExPct: 0.68 },
  'Barnet Dental': { rev: 0.13, profitPct: 0.17, cashConvPct: 0.91, opExPct: 0.72 },
  'Fixed Teeth Solutions Bexleyheath': { rev: 0.17, profitPct: 0.26, cashConvPct: 0.95, opExPct: 0.63 },
};

export const STAGES = [
  { key: 'new', label: 'New' },
  { key: 'contact_attempted', label: 'Contact attempted' },
  { key: 'contact_made', label: 'Contact made' },
  { key: 'consultation_booked', label: 'Consult booked' },
  { key: 'consultation_attended', label: 'Consult attended' },
  { key: 'treatment_started', label: 'Treatment started' },
] as const;

export type Lead = {
  id: number;
  practice: string;
  status: string;
  created: string;
};

export const SAMPLE_LEADS: Lead[] = [
  { id: 1, practice: 'Warwick Lodge Implant Centre', status: 'consultation_booked', created: '2026-05-12T09:30:00Z' },
  { id: 2, practice: 'Ashford Dental', status: 'contact_made', created: '2026-05-14T14:15:00Z' },
  { id: 3, practice: 'Rochester Dental', status: 'new', created: '2026-05-16T08:00:00Z' },
  { id: 4, practice: 'Warwick Lodge Implant Centre', status: 'treatment_started', created: '2026-04-28T11:20:00Z' },
  { id: 5, practice: 'Barnet Dental', status: 'consultation_attended', created: '2026-05-08T16:45:00Z' },
  { id: 6, practice: 'Fixed Teeth Solutions Bexleyheath', status: 'contact_attempted', created: '2026-05-15T10:00:00Z' },
  { id: 7, practice: 'Ashford Dental', status: 'new', created: '2026-05-17T07:30:00Z' },
  { id: 8, practice: 'Rochester Dental', status: 'contact_made', created: '2026-05-13T13:00:00Z' },
  { id: 9, practice: 'Warwick Lodge Implant Centre', status: 'consultation_booked', created: '2026-05-11T15:30:00Z' },
  { id: 10, practice: 'Barnet Dental', status: 'treatment_started', created: '2026-05-02T09:00:00Z' },
  { id: 11, practice: 'Fixed Teeth Solutions Bexleyheath', status: 'new', created: '2026-05-17T11:30:00Z' },
  { id: 12, practice: 'Ashford Dental', status: 'consultation_attended', created: '2026-05-06T14:00:00Z' },
];

export type PLLine = { id: string; label: string; pct: number; type: string; fixed?: boolean };
export type PLModel = { turnover: number; cogs: PLLine[]; opex: PLLine[]; targetMargin: number };

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

// Synthesised 12-month group series at the prototype's scale (~£10.3m/yr,
// 5 practices). Real dataset is a gzip blob in the prototype; only shape
// ({ month, revenue }) and believable magnitude matter for visual parity.
export type SeriesMonth = { month: string; revenue: number };

export const DATASET: { totals: { total_revenue_year: number }; monthly_series: SeriesMonth[] } = (() => {
  const months = [
    '2025-06', '2025-07', '2025-08', '2025-09', '2025-10', '2025-11',
    '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05',
  ];
  const monthly_series = months.map((month, i) => ({
    month,
    revenue: Math.round(815000 + i * 9000 + (i % 3) * 12000),
  }));
  const total_revenue_year = monthly_series.reduce((s, m) => s + m.revenue, 0);
  return { totals: { total_revenue_year }, monthly_series };
})();

export type PracticeFinancials = {
  practice: string;
  weight: Weight;
  annual: {
    turnover: number;
    netProfit: number;
    cashCollected: number;
    opEx: number;
    cashflow: number;
    targetProfit: number;
    profitGap: number;
    excessCash: number;
    reserve: number;
    profitPct: number;
  };
  series: { month: string; revenue: number; profit: number; cash: number; target: number }[];
};

export function getPracticeFinancials(practice: string): PracticeFinancials {
  const ds = DATASET;
  const w = PRACTICE_WEIGHTS[practice] || PRACTICE_WEIGHTS['All practices'];

  const turnover = Math.round(ds.totals.total_revenue_year * w.rev);
  const netProfit = Math.round(turnover * w.profitPct);
  const cashCollected = Math.round(turnover * w.cashConvPct);
  const opEx = Math.round(turnover * w.opExPct);
  const cashflow = cashCollected - opEx;
  const targetProfit = Math.round(turnover * TARGET_PROFIT_PCT);
  const profitGap = targetProfit - netProfit;
  const reserve = Math.round((opEx / 12) * 2);
  const excessCash = Math.max(0, cashflow - reserve);

  const series = ds.monthly_series.map((m) => ({
    month: m.month,
    revenue: Math.round(m.revenue * w.rev),
    profit: Math.round(m.revenue * w.rev * w.profitPct),
    cash: Math.round(m.revenue * w.rev * w.cashConvPct),
    target: Math.round(m.revenue * w.rev * TARGET_PROFIT_PCT),
  }));

  return {
    practice,
    weight: w,
    annual: {
      turnover,
      netProfit,
      cashCollected,
      opEx,
      cashflow,
      targetProfit,
      profitGap,
      excessCash,
      reserve,
      profitPct: w.profitPct,
    },
    series,
  };
}

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
  const fixedAtCurrent = m.opex.filter((l) => l.fixed).reduce((s, l) => s + (T * l.pct) / 100, 0);
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

export function getRangeMonths(range: DateRange): SeriesMonth[] {
  const series = DATASET.monthly_series;
  if (range === 'mtd') return series.slice(-1);
  if (range === 'qtd') return series.slice(-3);
  if (range === '6m') return series.slice(-6);
  return series.slice(-12);
}

export function rangeLabel(r: DateRange): string {
  return (
    { mtd: 'Last month', qtd: 'Last quarter', ytd: 'Last 12 months', '6m': 'Last 6 months' } as Record<
      DateRange,
      string
    >
  )[r] || 'Last 12 months';
}

// Compact pound formatter (£1.2m / £45k) — prototype _ccPounds.
export function ccPounds(n: number): string {
  if (n === null || n === undefined || isNaN(n)) return '£0';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_000_000) return sign + '£' + (abs / 1_000_000).toFixed(2) + 'm';
  if (abs >= 1000) return sign + '£' + Math.round(abs / 1000) + 'k';
  return sign + '£' + Math.round(abs).toLocaleString('en-GB');
}

// Full pound formatter — prototype _ccPoundsFull.
export function ccPoundsFull(n: number): string {
  if (n === null || n === undefined || isNaN(n)) return '£0';
  return (n < 0 ? '-' : '') + '£' + Math.abs(Math.round(n)).toLocaleString('en-GB');
}
