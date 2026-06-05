'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  computeValuation,
  computeExitPlan,
  type ValuationCompute,
  type ExitPlan,
  type ExitPlanInput,
} from './valuation-api';
import type { ValuationState, ValuationBase } from './mock';

// Debounce any value by `ms` — slider drags shouldn't fire a request per tick.
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

// Server-authoritative valuation recompute (Arch #3). `placeholderData: prev`
// keeps the last result visible while a new compute is in flight, so dragging a
// slider doesn't flash the headline empty.
export function useValuationCompute(state: ValuationState, base: ValuationBase) {
  const debounced = useDebounced({ state, base }, 250);
  return useQuery<ValuationCompute>({
    queryKey: ['valuation-compute', debounced],
    queryFn: () => computeValuation(debounced.state, debounced.base),
    placeholderData: (prev) => prev,
  });
}

export function useValuationExitPlan(input: ExitPlanInput) {
  const debounced = useDebounced(input, 250);
  return useQuery<ExitPlan>({
    queryKey: ['valuation-exit-plan', debounced],
    queryFn: () => computeExitPlan(debounced),
    placeholderData: (prev) => prev,
  });
}
