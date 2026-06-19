'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchWealthInputs,
  saveWealthInputs,
  fetchNetWorth,
  fetchExitPlan,
  fetchExitPlanCompare,
  computeExitPlan,
  type WealthInputs,
  type WealthInputsBody,
  type NetWorth,
  type ExitPlanResponse,
  type ExitPlanCompare,
  type ExitPlanResult,
  type ExitPlanInput,
} from './wealth-api';

// Wealth (Exit Plan / FIRE) server state. Owner-only screens. Saving the
// personal balance sheet invalidates the derived net-worth + exit-plan reads
// so the FIRE banner and Net Worth table reflect the change immediately.

const INPUTS_KEY = ['wealth-inputs'];
const NET_KEY = ['wealth-net'];
const FIRE_KEY = ['wealth-fire'];
const FIRE_COMPARE_KEY = ['wealth-fire-compare'];

export function useWealthInputs() {
  return useQuery<WealthInputs>({
    queryKey: INPUTS_KEY,
    queryFn: fetchWealthInputs,
    staleTime: 60_000,
  });
}

export function useNetWorth() {
  return useQuery<NetWorth>({
    queryKey: NET_KEY,
    queryFn: fetchNetWorth,
    staleTime: 60_000,
  });
}

export function useExitPlan() {
  return useQuery<ExitPlanResponse>({
    queryKey: FIRE_KEY,
    queryFn: fetchExitPlan,
    staleTime: 60_000,
  });
}

// Saved snapshot vs live re-resolved plan (drift since last save).
export function useExitPlanCompare() {
  return useQuery<ExitPlanCompare>({
    queryKey: FIRE_COMPARE_KEY,
    queryFn: fetchExitPlanCompare,
    staleTime: 60_000,
  });
}

// Slider recompute (no persistence). The screen debounces calls to this.
export function useComputeExitPlan() {
  return useMutation<ExitPlanResult, Error, ExitPlanInput>({
    mutationFn: computeExitPlan,
  });
}

export function useSaveWealthInputs() {
  const qc = useQueryClient();
  return useMutation<WealthInputs, Error, WealthInputsBody>({
    mutationFn: saveWealthInputs,
    onSuccess: (data) => {
      qc.setQueryData(INPUTS_KEY, data);
      qc.invalidateQueries({ queryKey: NET_KEY });
      qc.invalidateQueries({ queryKey: FIRE_KEY });
      qc.invalidateQueries({ queryKey: FIRE_COMPARE_KEY });
    },
  });
}
