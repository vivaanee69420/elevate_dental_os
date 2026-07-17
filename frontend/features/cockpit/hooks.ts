// frontend/features/cockpit/hooks.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchCockpit,
  fetchCockpitLeads,
  fetchCockpitTreatments,
  fetchCockpitCashupDays,
  type CockpitParams,
  type CockpitDetailParams,
} from './api';
import { fetchCostModel, saveCostModel, type CostModelInput } from './cost-model-api';

// Daily Command Cockpit. Key includes since/until/scope (from the shared
// ScopePeriod window + practice filter) so it refetches when either changes.
export function useCockpit(params: CockpitParams = {}) {
  return useQuery({
    queryKey: ['cockpit', params.since ?? '', params.until ?? '', params.scope ?? ''],
    queryFn: () => fetchCockpit(params),
    staleTime: 30_000,
  });
}

// Lazy detail hooks — fetched only once a drill-down panel is opened
// (`enabled: open`). Query key includes every param so it refetches on
// window/practice change even while the panel stays open.
export function useCockpitLeads(open: boolean, params: CockpitDetailParams = {}) {
  return useQuery({
    queryKey: ['cockpit-leads', params.since ?? '', params.until ?? '', params.practiceId ?? '', params.limit ?? '', params.offset ?? ''],
    queryFn: () => fetchCockpitLeads(params),
    enabled: open,
    staleTime: 30_000,
  });
}

export function useCockpitTreatments(open: boolean, params: CockpitDetailParams = {}) {
  return useQuery({
    queryKey: ['cockpit-treatments', params.since ?? '', params.until ?? '', params.practiceId ?? '', params.limit ?? '', params.offset ?? ''],
    queryFn: () => fetchCockpitTreatments(params),
    enabled: open,
    staleTime: 30_000,
  });
}

export function useCockpitCashupDays(open: boolean, params: CockpitDetailParams = {}) {
  return useQuery({
    queryKey: ['cockpit-cashup-days', params.since ?? '', params.until ?? '', params.practiceId ?? '', params.limit ?? '', params.offset ?? ''],
    queryFn: () => fetchCockpitCashupDays(params),
    enabled: open,
    staleTime: 30_000,
  });
}

export function useCostModel(asOf?: string) {
  return useQuery({
    queryKey: ['cockpit-cost-model', asOf ?? 'today'],
    queryFn: () => fetchCostModel(asOf),
    staleTime: 30_000,
  });
}

export function useSaveCostModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ practiceId, input }: { practiceId: string; input: CostModelInput }) =>
      saveCostModel(practiceId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cockpit-cost-model'] });
      // The cockpit payload derives §6 and §1's target from this model, so it
      // must refetch too — invalidate the key prefix, since the cockpit query is
      // keyed by scope+window and we don't know which one is mounted.
      qc.invalidateQueries({ queryKey: ['cockpit'] });
    },
  });
}
