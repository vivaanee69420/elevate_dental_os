import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getLeadFunnel, getLeadReport, listLeads, listPipelines, updateLead, type LeadsListFilters, type LeadUpdateInput } from './api';

export function useLeads(filters: LeadsListFilters = {}) {
  return useQuery({
    queryKey: ['leads', filters],
    queryFn: () => listLeads(filters),
    staleTime: 30_000,
  });
}

// GHL pipeline definitions for the dynamic Pipeline screen + selector.
export function usePipelines(accountId?: string | null) {
  return useQuery({
    queryKey: ['lead-pipelines', accountId ?? null],
    queryFn: () => listPipelines(accountId),
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

// Server-aggregated funnel for a window. Never compute a funnel from useLeads()
// — that list is capped and ordered newest-first.
export function useLeadFunnel(opts: {
  since?: string | null;
  until?: string | null;
  practiceId?: string | null;
} = {}) {
  return useQuery({
    queryKey: ['lead-funnel', opts.since ?? null, opts.until ?? null, opts.practiceId ?? null],
    queryFn: () => getLeadFunnel(opts),
    staleTime: 30_000,
  });
}

// Every CRM Reports figure, server-aggregated. Never count a page of leads.
export function useLeadReport(opts: {
  since?: string | null;
  until?: string | null;
  practiceId?: string | null;
  accountId?: string | null;
} = {}) {
  return useQuery({
    queryKey: ['lead-report', opts.since ?? null, opts.until ?? null,
               opts.practiceId ?? null, opts.accountId ?? null],
    queryFn: () => getLeadReport(opts),
    staleTime: 30_000,
  });
}
