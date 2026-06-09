import { api } from '@/lib/api';

// Server-authoritative M&A Acquisition Modeller (buy-side, DentaCFO gap Phase 3).
// The deal FORMULA lives in the backend (lib/formulas.js → calculateAcquisition,
// FORMULAS.md §M&A, tested) — no client duplication. The screen works in whole
// pounds; these adapters convert pounds→pence on the way in and pence→pounds on
// the way out. Pure compute, debounced, no persistence (Arch #3).

const toPence = (pounds: number) => Math.round((pounds || 0) * 100);
const toPounds = (pence: number) => (pence || 0) / 100;

export interface AcquisitionInput {
  targetRevenue: number; // pounds/yr
  marginPct: number;
  multiple: number; // EV / EBITDA
  growthPct: number;
  horizonYears: number;
  discountPct: number;
  leverageMultiple: number;
  askingPrice: number | null; // pounds, optional
}

export interface AcquisitionFlag {
  key: string;
  severity: 'high' | 'medium';
  message: string;
}

export interface AcquisitionResult {
  ebitda: number; // pounds
  ev: number;
  debtCapacity: number;
  equityRequired: number;
  terminal: number;
  npv: number;
  irrPct: number | null;
  paybackYears: number | null;
  premium: number | null; // pounds
  premiumPct: number | null;
  horizonYears: number;
  leverageMultiple: number;
  flags: AcquisitionFlag[];
}

export const ACQUISITION_DEFAULTS: AcquisitionInput = {
  targetRevenue: 1_200_000,
  marginPct: 18,
  multiple: 7,
  growthPct: 5,
  horizonYears: 5,
  discountPct: 10,
  leverageMultiple: 3.5,
  askingPrice: null,
};

export async function computeAcquisition(input: AcquisitionInput): Promise<AcquisitionResult> {
  const raw = await api<{
    ebitdaPence: number;
    evPence: number;
    debtCapacityPence: number;
    equityRequiredPence: number;
    terminalPence: number;
    npvPence: number;
    irrPct: number | null;
    paybackYears: number | null;
    premiumPence: number | null;
    premiumPct: number | null;
    horizonYears: number;
    leverageMultiple: number;
    flags: AcquisitionFlag[];
  }>('/api/analytics/compute/acquisition', {
    method: 'POST',
    body: JSON.stringify({
      targetRevenuePence: toPence(input.targetRevenue),
      marginPct: input.marginPct,
      multiple: input.multiple,
      growthPct: input.growthPct,
      horizonYears: input.horizonYears,
      discountPct: input.discountPct,
      leverageMultiple: input.leverageMultiple,
      askingPricePence: input.askingPrice == null ? null : toPence(input.askingPrice),
    }),
  });
  return {
    ebitda: toPounds(raw.ebitdaPence),
    ev: toPounds(raw.evPence),
    debtCapacity: toPounds(raw.debtCapacityPence),
    equityRequired: toPounds(raw.equityRequiredPence),
    terminal: toPounds(raw.terminalPence),
    npv: toPounds(raw.npvPence),
    irrPct: raw.irrPct,
    paybackYears: raw.paybackYears,
    premium: raw.premiumPence == null ? null : toPounds(raw.premiumPence),
    premiumPct: raw.premiumPct,
    horizonYears: raw.horizonYears,
    leverageMultiple: raw.leverageMultiple,
    flags: raw.flags ?? [],
  };
}
