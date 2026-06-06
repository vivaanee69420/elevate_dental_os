'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getChairConfig, saveChairConfig, type ChairConfig } from './chair-config-api';

// Saved per-org chair-capacity config (Phase 3 / T12). Saving invalidates the
// chair-analytics query so the capacity numbers refresh immediately.
export function useChairConfig() {
  return useQuery<ChairConfig>({
    queryKey: ['chair-config'],
    queryFn: getChairConfig,
    staleTime: 60_000,
  });
}

export function useSaveChairConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (cfg: ChairConfig) => saveChairConfig(cfg),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['chair-config'] });
      qc.invalidateQueries({ queryKey: ['chair-analytics'] });
    },
  });
}
