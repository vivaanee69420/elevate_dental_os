import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchCommunications,
  sendCommunication,
  fetchGhlWorkflows,
  type CommunicationsListFilters,
  type SendCommunicationInput,
} from './api';

export function useGhlWorkflows(accountId?: string | null) {
  return useQuery({
    queryKey: ['ghl-workflows', accountId ?? 'all'],
    queryFn: () => fetchGhlWorkflows(accountId),
    staleTime: 60_000,
  });
}

export function useCommunications(filters: CommunicationsListFilters = {}) {
  return useQuery({
    queryKey: ['communications', filters],
    queryFn: () => fetchCommunications(filters),
    staleTime: 30_000,
  });
}

export function useSendCommunication() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SendCommunicationInput) => sendCommunication(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['communications'] });
    },
  });
}
