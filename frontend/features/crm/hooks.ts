import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchCommunications,
  sendCommunication,
  type CommunicationsListFilters,
  type SendCommunicationInput,
} from './api';

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
