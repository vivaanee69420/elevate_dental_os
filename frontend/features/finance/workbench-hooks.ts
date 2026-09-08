'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchTreatmentModels,
  computeTreatmentEconomics,
  fetchTreatmentFeeBenchmarks,
  saveTreatmentModel,
  deleteTreatmentModel,
  type TreatmentModel,
} from './workbench-api';

// Seed default models (fullarch/implant/invisalign) from the backend.
export function useTreatmentModels() {
  return useQuery({ queryKey: ['treatment-models'], queryFn: fetchTreatmentModels, staleTime: Infinity });
}

// Real case-fee benchmarks from Dentally invoice_items (12mo). Used to seed the
// workbench case fee with the real average; owner can revert to the default.
export function useTreatmentFeeBenchmarks(opts: {
  practiceId?: string | null; since?: string | null; until?: string | null;
} = {}) {
  return useQuery({
    // Scope MUST be in the key, or the first practice's fees are served for
    // every other one and the filter looks broken.
    queryKey: ['treatment-fee-benchmarks', opts.practiceId ?? null, opts.since ?? null, opts.until ?? null],
    queryFn: () => fetchTreatmentFeeBenchmarks(opts),
    staleTime: 5 * 60_000,
  });
}

// Debounce any value by `ms` — used so slider drags don't fire a request per tick.
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

// Server-authoritative recompute (Arch #3): debounce the model, post it, return
// the computed figures. `keepPreviousData` keeps the last result visible while a
// new compute is in flight so the UI doesn't flash empty between drags.
export function useTreatmentEconomics(model: TreatmentModel | null) {
  const debounced = useDebounced(model, 250);
  return useQuery({
    queryKey: ['treatment-economics', debounced],
    queryFn: () => computeTreatmentEconomics(debounced as TreatmentModel),
    enabled: !!debounced,
    placeholderData: (prev) => prev,
  });
}

// --- Saving --------------------------------------------------------------
// Both mutations invalidate ['treatment-models'] on success. That query is
// staleTime:Infinity, so WITHOUT this the page would keep serving the models it
// loaded on mount and a save would appear to do nothing — the owner would save
// twice, refresh, and find their figures already there, which reads as a bug in
// both directions.

export function useSaveTreatmentModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, model }: { key: string; model: TreatmentModel }) => saveTreatmentModel(key, model),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['treatment-models'] }); },
  });
}

export function useDeleteTreatmentModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => deleteTreatmentModel(key),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['treatment-models'] }); },
  });
}
