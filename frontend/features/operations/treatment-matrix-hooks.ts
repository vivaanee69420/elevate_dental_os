'use client';

import { useQuery } from '@tanstack/react-query';
import { useScopePeriod, scopeKey } from '@/features/_shared/scope-context';
import { fetchTreatmentMatrix, fetchTreatmentRevenue } from './treatment-matrix-api';

// Volume matrix — appointment count by type x practice. Refetches on scope/period
// change. `enabled` lets the screen fetch only the active mode (Volume vs £).
export function useTreatmentMatrix(enabled = true) {
  const sp = useScopePeriod();
  return useQuery({
    queryKey: ['treatment-matrix', scopeKey(sp)],
    queryFn: () => fetchTreatmentMatrix(sp.scope, sp.period, sp.periodKey),
    staleTime: 60_000,
    enabled,
  });
}

// Revenue matrix — real invoiced fee (pence) by treatment name x practice.
export function useTreatmentRevenue(enabled = true) {
  const sp = useScopePeriod();
  return useQuery({
    queryKey: ['treatment-revenue', scopeKey(sp)],
    queryFn: () => fetchTreatmentRevenue(sp.scope, sp.period, sp.periodKey),
    staleTime: 60_000,
    enabled,
  });
}
