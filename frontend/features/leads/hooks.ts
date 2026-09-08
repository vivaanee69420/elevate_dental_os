import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getEnquiries, getLeadFunnel, getLeadReport, getPipelineSummary, getTodayCounters, listLeads, listPipelines, updateLead, type EnquiriesFilters, type LeadsListFilters, type LeadUpdateInput } from './api';

// Board counts and value for one pipeline, computed in SQL over every lead in
// it rather than over the page the board happens to have fetched.
export function usePipelineSummary(pipelineId: string | null, accountId?: string | null) {
  return useQuery({
    queryKey: ['pipeline-summary', pipelineId, accountId ?? null],
    queryFn: () => getPipelineSummary({ pipelineId: pipelineId as string, accountId }),
    enabled: !!pipelineId,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}

export function useEnquiries(filters: EnquiriesFilters = {}) {
  return useQuery({
    queryKey: ['enquiries', filters],
    queryFn: () => getEnquiries(filters),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}

export function useTodayCounters(opts: { since?: string | null; accountId?: string | null } = {}) {
  return useQuery({
    queryKey: ['today-counters', opts.since ?? null, opts.accountId ?? null],
    queryFn: () => getTodayCounters(opts),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}

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
