// frontend/features/cockpit/cost-model-api.ts
// The manual per-practice inputs behind §6 Profit vs Breakeven and §1's Daily
// target. Money is integer PENCE over the wire; the UI edits in whole pounds and
// converts at its boundary (Math.round(Number(raw) * 100)), per repo convention.
import { api } from '@/lib/api';

export interface CostModelRow {
  practiceId: string;
  name: string;
  /** null when this practice has no cost model at all. */
  effectiveFrom: string | null;
  fixedCostPenceMonth: number | null;
  breakevenLowPence: number | null;
  breakevenHighPence: number | null;
  workingDaysPerMonth: number;
  revenueTargetPenceMonth: number | null;
}

export interface CostModelResponse {
  asOf: string;
  rows: CostModelRow[];
}

export interface CostModelInput {
  fixedCostPenceMonth?: number | null;
  breakevenLowPence?: number | null;
  breakevenHighPence?: number | null;
  workingDaysPerMonth?: number;
  revenueTargetPenceMonth?: number | null;
}

export function fetchCostModel(asOf?: string) {
  const qs = asOf ? `?asOf=${encodeURIComponent(asOf)}` : '';
  return api<CostModelResponse>(`/api/cockpit/cost-model${qs}`);
}

export function saveCostModel(practiceId: string, input: CostModelInput) {
  return api<CostModelRow>(`/api/cockpit/cost-model/${practiceId}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}
