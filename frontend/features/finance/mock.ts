// Finance section mock-data layer.
//
// Mirrors the client-side arithmetic in preview/elevate-dental-os-v2.html for
// the Finance screens (PAGES.profit / PAGES.cashflow / PAGES.financial /
// PAGES.valuation). The real backend exposes patient payments only; the
// 12-month consolidated P&L series, balance sheet and valuation engine do not
// exist server-side yet, so this module synthesises them at the prototype's
// scale so the screens render pixel-faithful with no API calls.
//
// Convention: amounts are WHOLE POUNDS (matches the prototype's arithmetic).
// The real backend uses integer pence (lib/formulas.js); pence->pound
// conversion happens at the future swap point, not here.
//
// When real endpoints land, swap the data source here — the screen component
// contracts stay stable.

// ----------------------------------------------------------------------------
// 12-month consolidated monthly series
// ----------------------------------------------------------------------------
//
// The prototype's real dataset is a gzip blob; only the shape and believable
// magnitude matter for visual parity. Each month carries the full P&L line
// breakdown the Finance screens consume. Cost lines are derived as fixed
// percentages of revenue so margins land in the prototype's ~10% band.

/** A single month of consolidated group P&L (whole pounds). */
export interface FinanceMonth {
  month: string; // 'YYYY-MM'
  revenue: number;
  associate_pay: number;
  staff_costs: number;
  lab_materials: number;
  opex: number;
  profit: number;
}

// Synthetic FINANCE_SERIES / buildSeries deleted — finance screens now fetch
// real data (./api.ts ← /api/analytics/finance-series, baseline-derived).
// annualTotal stays a pure helper over whatever FinanceMonth[] is passed.

/** Sum a P&L field across the whole series (annual total). */
export function annualTotal(series: FinanceMonth[]) {
  return series.reduce(
    (acc, m) => ({
      revenue: acc.revenue + m.revenue,
      associate_pay: acc.associate_pay + m.associate_pay,
      staff_costs: acc.staff_costs + m.staff_costs,
      lab_materials: acc.lab_materials + m.lab_materials,
      opex: acc.opex + m.opex,
      profit: acc.profit + m.profit,
    }),
    { revenue: 0, associate_pay: 0, staff_costs: 0, lab_materials: 0, opex: 0, profit: 0 },
  );
}

// ----------------------------------------------------------------------------
// Formatting helpers (prototype formatPoundsCompact)
// ----------------------------------------------------------------------------

/**
 * Compact pound formatter — prototype `formatPoundsCompact`.
 * e.g. 1_240_000 -> "£1.2M", 45_300 -> "£45k", 920 -> "£920".
 */
export function poundsCompact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return '£' + (n / 1_000_000).toFixed(1) + 'M';
  if (Math.abs(n) >= 1_000) return '£' + Math.round(n / 1_000) + 'k';
  return '£' + Math.round(n);
}

/**
 * Currency formatter for valuation figures — prototype `formatCurrency`.
 * thousands -> £Xk, millions -> £X.XM (1dp >= £10M, else 2dp).
 */
export function formatCurrency(amount: number): string {
  if (amount == null || isNaN(amount)) return '£0';
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  if (abs >= 1_000_000) return `${sign}£${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2)}M`;
  if (abs >= 1_000) return `${sign}£${Math.round(abs / 1_000)}k`;
  return `${sign}£${Math.round(abs)}`;
}

/** Format a 'YYYY-MM' key as e.g. "Jun 2025" (en-GB). */
export function monthLabel(key: string): string {
  return new Date(key + '-15').toLocaleDateString('en-GB', {
    month: 'short',
    year: 'numeric',
  });
}

/** Short month name for chart axes, e.g. "2025-06" -> "Jun". */
export function monthShort(key: string): string {
  const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return m[parseInt(key.split('-')[1], 10) - 1] ?? key;
}

// ----------------------------------------------------------------------------
// Valuation constants & engine (prototype VALUATION section)
// ----------------------------------------------------------------------------

export type PracticeType = 'nhs' | 'mixed' | 'private';
export type DsoTier = 'bolt_on' | 'small_group' | 'mid_platform' | 'large_platform';
export type RegionKey =
  | 'london' | 'south_east' | 'midlands' | 'wales'
  | 'south_west' | 'north' | 'scotland' | 'ni';

/** Industry-average multiples + sale benchmarks per practice type. */
export const PRACTICE_TYPE_MULTIPLES: Record<
  PracticeType,
  { associate: number; principal: number; dso: number; avgSale: number; percTurnover: number }
> = {
  nhs: { associate: 6.4, principal: 2.9, dso: 5.5, avgSale: 1150000, percTurnover: 1.3 },
  mixed: { associate: 7.0, principal: 3.3, dso: 6.5, avgSale: 1500000, percTurnover: 1.42 },
  private: { associate: 7.3, principal: 3.5, dso: 7.0, avgSale: 1550000, percTurnover: 1.55 },
};

/** DSO tier scale factor applied to the base DSO multiple, plus copy. */
export const DSO_TIER_MULTIPLIERS: Record<
  DsoTier,
  { factor: number; label: string; range: string }
> = {
  bolt_on: { factor: 0.95, label: 'Bolt-on (1-9 sites)', range: '5-7x' },
  small_group: { factor: 1.05, label: 'Small group (10-30 sites)', range: '7-8x' },
  mid_platform: { factor: 1.3, label: 'Mid platform (30-100 sites)', range: '8-10x' },
  large_platform: { factor: 1.55, label: 'Large platform (100+ sites)', range: '10-12x' },
};

/** Explanatory copy shown under the DSO tier selector. */
export const DSO_TIER_INFO: Record<DsoTier, string> = {
  bolt_on:
    'Bolt-on: Corporates buy at lower multiple, integrate into platform. Typical buyers: MyDentist, Bupa Dental, PortmanDentex bolt-ons.',
  small_group:
    'Small group: Attractive to mid-tier consolidators. Better systems mean less integration risk for buyer.',
  mid_platform:
    'Mid platform: PE-backed micro-consolidators (PortmanDentex pre-merger size). Premium for scale and management depth.',
  large_platform:
    'Large platform: Reference: MyDentist sold to Bridgepoint Jul 2025 at 10x (£800M / £74M EBITDA). Strategic premium.',
};

/** Regional valuation adjustment factor + display label. */
export const REGION_ADJUSTMENTS: Record<RegionKey, { factor: number; label: string }> = {
  london: { factor: 1.075, label: '+7.5%' },
  south_east: { factor: 1.05, label: '+5%' },
  midlands: { factor: 1.0, label: 'Baseline' },
  wales: { factor: 1.0, label: 'Baseline' },
  south_west: { factor: 0.97, label: '-3%' },
  north: { factor: 0.95, label: '-5%' },
  scotland: { factor: 0.97, label: '-3%' },
  ni: { factor: 0.95, label: '-5%' },
};

/** Human-readable region names for the region selector. */
export const REGIONS_DISPLAY: Record<RegionKey, string> = {
  london: 'London',
  south_east: 'South East',
  midlands: 'Midlands',
  wales: 'Wales',
  south_west: 'South West',
  north: 'North',
  scotland: 'Scotland',
  ni: 'N. Ireland',
};

/** The full set of mutable inputs that drive a valuation. */
export interface ValuationState {
  addBacks: number;
  principalSalary: number;
  practiceType: PracticeType;
  nhsPercent: number;
  region: RegionKey;
  siteCount: number;
  dsoTier: DsoTier;
  growthRate: number;
  associateMultiple: number;
  principalMultiple: number;
  dsoMultiple: number;
}

/** Read-only base figures derived from the trailing-12-month series. */
export interface ValuationBase {
  ttmRevenue: number;
  reportedEbitda: number;
}

/** Industry-default multiples for a practice type + DSO tier. */
export function getDefaultMultiples(practiceType: PracticeType, dsoTier: DsoTier) {
  const t = PRACTICE_TYPE_MULTIPLES[practiceType] ?? PRACTICE_TYPE_MULTIPLES.mixed;
  const dsoTierFactor = DSO_TIER_MULTIPLIERS[dsoTier]?.factor ?? 1.0;
  return { associate: t.associate, principal: t.principal, dso: t.dso * dsoTierFactor };
}

/** The result of running the three-model valuation engine. */
export interface ValuationResult {
  reportedEbitda: number;
  associateEbitda: number;
  principalNetProfit: number;
  principalValuation: number;
  associateValuation: number;
  dsoValuation: number;
  midpoint: number;
  strategic: number;
  regionFactor: number;
  growthAdjust: number;
}

// The three-model valuation engine is now SERVER-AUTHORITATIVE — it lives in
// backend `lib/formulas.js` (`computeGroupValuation`, FORMULAS.md §13, tested)
// and is reached via `useValuationCompute` (../valuation-hooks) which posts the
// state and returns this `ValuationResult` shape. The formula is intentionally
// NOT duplicated here (project rule: formulas.js is the single source for
// financial calcs). The constants/types/defaults above remain client-side as UI
// config + benchmark display.

/** Default valuation inputs (prototype localStorage fallbacks). */
export function defaultValuationState(): ValuationState {
  const base: Omit<ValuationState, 'associateMultiple' | 'principalMultiple' | 'dsoMultiple'> = {
    addBacks: 0,
    principalSalary: 120000,
    practiceType: 'mixed',
    nhsPercent: 25,
    region: 'south_east',
    siteCount: 5,
    dsoTier: 'bolt_on',
    growthRate: 10,
  };
  const m = getDefaultMultiples(base.practiceType, base.dsoTier);
  return {
    ...base,
    associateMultiple: m.associate,
    principalMultiple: m.principal,
    dsoMultiple: m.dso,
  };
}

// valuationBase() deleted — the valuation base (TTM revenue + reported
// EBITDA) now comes from the real finance-series via ./api.ts
// getValuationBase(); the ValuationBase type is kept for the engine signature.
