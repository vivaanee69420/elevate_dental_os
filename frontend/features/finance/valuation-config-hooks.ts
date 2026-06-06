'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getValuationInputs,
  saveValuationInputs,
  type SavedValuationInputs,
} from './valuation-config-api';
import type { ValuationState, ValuationBase } from './mock';

// Saved per-org valuation drivers (Phase 3 / T12). The query seeds the screen
// on load; the mutation persists the current state (valuation.edit, audited).
export function useValuationInputs() {
  return useQuery<SavedValuationInputs | null>({
    queryKey: ['valuation-inputs'],
    queryFn: getValuationInputs,
    staleTime: 60_000,
  });
}

export function useSaveValuationInputs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ state, base }: { state: ValuationState; base: ValuationBase }) =>
      saveValuationInputs(state, base),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['valuation-inputs'] }),
  });
}
