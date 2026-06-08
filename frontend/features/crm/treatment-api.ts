// "By treatment" breakdown for CRM Reports — REAL invoiced fees from Dentally
// (invoice_items), grouped by treatment_name. Replaces the old GHL-leads grouping
// which mis-used opp.name (junk like "New Lead || 22/03/2026") as the treatment.

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface TreatmentBreakdownRow {
  treatment_name: string;
  fee_pence: number;
  item_count: number;
  patient_count: number;
}

export interface TreatmentBreakdownResponse {
  treatments: TreatmentBreakdownRow[];
  grandTotal: number;
  basis: string;
  hasData: boolean;
  note: string;
}

export function fetchTreatmentBreakdown(limit = 24): Promise<TreatmentBreakdownResponse> {
  return api<TreatmentBreakdownResponse>(`/api/analytics/treatment-breakdown?limit=${limit}`);
}

export function useTreatmentBreakdown(limit = 24) {
  return useQuery({
    queryKey: ['treatment-breakdown', limit],
    queryFn: () => fetchTreatmentBreakdown(limit),
    staleTime: 60_000,
  });
}
