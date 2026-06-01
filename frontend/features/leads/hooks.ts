import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listLeads, listPipelines, updateLead, type LeadsListFilters, type LeadUpdateInput } from './api';

export function useLeads(filters: LeadsListFilters = {}) {
  return useQuery({
    queryKey: ['leads', filters],
    queryFn: () => listLeads(filters),
    staleTime: 30_000,
  });
}

// GHL pipeline definitions for the dynamic Pipeline screen + selector.
export function usePipelines() {
  return useQuery({
    queryKey: ['lead-pipelines'],
    queryFn: listPipelines,
    staleTime: 60_000,
  });
}

export function useUpdateLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: LeadUpdateInput }) =>
      updateLead(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leads'] });
    },
  });
}
