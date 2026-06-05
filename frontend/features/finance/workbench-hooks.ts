'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchTreatmentModels, computeTreatmentEconomics, type TreatmentModel } from './workbench-api';

// Seed default models (fullarch/implant/invisalign) from the backend.
export function useTreatmentModels() {
  return useQuery({ queryKey: ['treatment-models'], queryFn: fetchTreatmentModels, staleTime: Infinity });
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
