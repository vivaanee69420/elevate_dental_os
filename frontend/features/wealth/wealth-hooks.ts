'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchWealthInputs,
  saveWealthInputs,
  fetchNetWorth,
  fetchExitPlan,
  type WealthInputs,
  type WealthInputsBody,
  type NetWorth,
  type ExitPlan,
} from './wealth-api';

// Wealth (Exit Plan / FIRE) server state. Owner-only screens. Saving the
// personal balance sheet invalidates the derived net-worth + exit-plan reads
// so the FIRE banner and Net Worth table reflect the change immediately.

const INPUTS_KEY = ['wealth-inputs'];
const NET_KEY = ['wealth-net'];
const FIRE_KEY = ['wealth-fire'];

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
  return useQuery<ExitPlan>({
    queryKey: FIRE_KEY,
    queryFn: fetchExitPlan,
    staleTime: 60_000,
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
    },
  });
}
