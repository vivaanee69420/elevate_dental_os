import { api } from '@/lib/api';
import { REGION_ADJUSTMENTS, type ValuationState, type ValuationBase } from './mock';

// Persisted valuation drivers (Intelligence OS — Value & Growth, Phase 3 / T12).
// GET loads the saved per-org row; PUT upserts it (valuation.edit, audited).
// The screen works in whole pounds; pence conversion happens at this boundary.
// `uiState` carries the full screen state so the screen restores faithfully —
// the typed columns are the canonical, compute-ready drivers.

const toPence = (pounds: number) => Math.round((pounds || 0) * 100);
const toPounds = (pence: number) => (pence || 0) / 100;

export interface SavedValuationInputs {
  addBacks: number;            // pounds
  principalSalary: number;     // pounds
  uiState: ValuationState | null;
  updatedAt: string | null;
}

// GET — null when never configured (the screen keeps its own defaults).
export async function getValuationInputs(): Promise<SavedValuationInputs | null> {
  const raw = await api<{
    addBacksPence: number;
    principalSalaryPence: number;
    uiState: ValuationState | null;
    updatedAt: string | null;
  } | null>('/api/analytics/valuation-inputs');
  if (!raw) return null;
  return {
    addBacks: toPounds(raw.addBacksPence),
    principalSalary: toPounds(raw.principalSalaryPence),
    uiState: raw.uiState ?? null,
    updatedAt: raw.updatedAt ?? null,
  };
}

// PUT — persist the current screen state. Typed drivers feed the backend/
// compute/accountant; uiState restores the screen. reportedEbitda comes from
// the real finance base, not an editable field.
export async function saveValuationInputs(state: ValuationState, base: ValuationBase): Promise<void> {
  await api('/api/analytics/valuation-inputs', {
    method: 'PUT',
    body: JSON.stringify({
      reportedEbitdaPence: toPence(base.reportedEbitda),
      addBacksPence: toPence(state.addBacks),
      principalSalaryPence: toPence(state.principalSalary),
      principalMultiple: state.principalMultiple,
      associateMultiple: state.associateMultiple,
      dsoMultiple: state.dsoMultiple,
      regionFactor: REGION_ADJUSTMENTS[state.region]?.factor ?? 1,
      growthRatePct: state.growthRate,
      uiState: state,
    }),
  });
}
