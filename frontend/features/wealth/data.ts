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

// NOTE: wealth-net (NetWorthScreen) + wealth-fire (FirePlanScreen) are now wired
// to the live owner-only endpoints via ./api + ./hooks. Their former mock
// fixtures (ASSETS, LIABILITIES, FIRE, FIRE_NUMBER) were removed. EXIT_OPTIONS
// below stays mock — there is no backend source for the exit-strategy copy.
// PROPERTIES / PENSIONS / ANNUAL_ALLOWANCE below remain mock: their endpoints
// (/api/wealth/property | /pension) are Phase-7 stubs.

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
// wealth-fire — FIRE plan (exit-strategy copy only; figures are now live)
// ---------------------------------------------------------------------------

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
