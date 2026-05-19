// Wealth-section mock-data layer.
//
// Mirrors the fixtures hard-coded in preview/elevate-dental-os-v2.html for the
// four Wealth screens (wealth-net, wealth-prop, wealth-pen, wealth-fire).
// The shared @/features/_mock module is frozen; it already exposes the money
// formatters we need, so we only re-export those plus the per-screen
// fixtures. When real endpoints land, screens swap their data source; these
// contracts stay stable.
//
// Convention: amounts are WHOLE POUNDS (matches the prototype's arithmetic),
// consistent with @/features/_mock. Pence conversion happens at the future
// backend-swap point, not here. Owner-only section (project rule 5 / nav
// config: wealth-* is ownerOnly).

import { formatPounds, formatPoundsCompact } from '@/features/_mock';

// Re-export the shared whole-pound formatters so wealth screens pull every
// money helper from one module.
export { formatPounds, formatPoundsCompact };

// ---------------------------------------------------------------------------
// wealth-net — personal balance sheet
// ---------------------------------------------------------------------------

/** A single asset line on the personal balance sheet. */
export interface Asset {
  name: string;
  value: number;
  type: 'Business' | 'Property' | 'Pension' | 'Investments' | 'Cash';
  growth: number;
}

/** A single liability line on the personal balance sheet. */
export interface Liability {
  name: string;
  value: number;
  rate: number;
}

/** Personal assets, prototype values (whole pounds). */
export const ASSETS: Asset[] = [
  { name: 'GM Dental Group equity (5 practices)', value: 4100000, type: 'Business', growth: 12 },
  { name: 'GM Dental Lab (private valuation)', value: 380000, type: 'Business', growth: 8 },
  { name: 'Plan4Growth Academy (early-stage value)', value: 220000, type: 'Business', growth: 45 },
  { name: 'Primary residence — Herne Bay', value: 850000, type: 'Property', growth: 4 },
  { name: 'BTL Property #1 — Canterbury', value: 320000, type: 'Property', growth: 3.5 },
  { name: 'SIPP pension fund', value: 285000, type: 'Pension', growth: 7 },
  { name: 'ISA / S&S portfolio', value: 142000, type: 'Investments', growth: 9 },
  { name: 'Cash savings', value: 78000, type: 'Cash', growth: 0 },
];

/** Personal liabilities, prototype values (whole pounds). */
export const LIABILITIES: Liability[] = [
  { name: 'Residential mortgage', value: 320000, rate: 4.2 },
  { name: 'BTL mortgage', value: 180000, rate: 5.1 },
  { name: 'Business loans (director guarantees)', value: 95000, rate: 6.5 },
];

// ---------------------------------------------------------------------------
// wealth-prop — property portfolio
// ---------------------------------------------------------------------------

/** A single property in the portfolio. `yield` is null for own-use homes. */
export interface Property {
  name: string;
  address: string;
  value: number;
  mortgage: number;
  monthly_income: number;
  monthly_cost: number;
  yield: number | null;
  type: 'Residential' | 'Buy-to-let';
}

/** Property portfolio, prototype values (whole pounds). */
export const PROPERTIES: Property[] = [
  {
    name: 'Primary residence',
    address: 'Herne Bay, Kent',
    value: 850000,
    mortgage: 320000,
    monthly_income: 0,
    monthly_cost: 1850,
    yield: null,
    type: 'Residential',
  },
  {
    name: 'Canterbury BTL #1',
    address: 'Canterbury, Kent',
    value: 320000,
    mortgage: 180000,
    monthly_income: 1450,
    monthly_cost: 720,
    yield: 5.4,
    type: 'Buy-to-let',
  },
];

// ---------------------------------------------------------------------------
// wealth-pen — pensions
// ---------------------------------------------------------------------------

/** A single pension scheme. */
export interface Pension {
  name: string;
  balance: number;
  contributions_ytd: number;
  type: 'SIPP' | 'NHS' | 'Director';
}

/** Pension schemes, prototype values (whole pounds). */
export const PENSIONS: Pension[] = [
  { name: 'SIPP — Hargreaves Lansdown', balance: 285000, contributions_ytd: 32000, type: 'SIPP' },
  { name: 'NHS Pension Scheme', balance: 145000, contributions_ytd: 8400, type: 'NHS' },
  { name: 'Director pension (Aviva)', balance: 78000, contributions_ytd: 24000, type: 'Director' },
];

/** Annual pension allowance (prototype constant, whole pounds). */
export const ANNUAL_ALLOWANCE = 60000;

// ---------------------------------------------------------------------------
// wealth-fire — FIRE plan
// ---------------------------------------------------------------------------

/** FIRE-plan headline inputs (prototype constants, whole pounds). */
export const FIRE = {
  currentNW: 6275000,
  targetMonthlyIncome: 40000,
  yearsToFire: 7,
  /** Annual required savings used in the path table. */
  annualSavings: 280000,
} as const;

/** FIRE number = 25x annual expenses (the "4% rule"). */
export const FIRE_NUMBER = FIRE.targetMonthlyIncome * 12 * 25;

/** One exit-strategy option shown on the FIRE screen. */
export interface ExitOption {
  title: string;
  detail: string;
}

/** Exit strategy options (prototype copy, British English). */
export const EXIT_OPTIONS: ExitOption[] = [
  {
    title: '1. Sell GM Dental Group',
    detail: `DSO sale at 8x EBITDA = ${formatPoundsCompact(5100000)}. Combined with property + pensions = FIRE achieved.`,
  },
  {
    title: '2. Hire CEO, retain group',
    detail:
      '£120k CEO + 5% equity. Take £200k/year dividend. Slower but retains asset growth.',
  },
  {
    title: '3. Semi-retire (3 days/week)',
    detail:
      'Hybrid model. Continue implant clinical work + group oversight. Reduce to £150k personal income.',
  },
];
