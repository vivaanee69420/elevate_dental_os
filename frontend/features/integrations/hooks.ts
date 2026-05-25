import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listIntegrations,
  startConnect,
  revokeIntegration,
  submitBrokerKey,
  type ConnectInput,
} from './api';

export function useIntegrations() {
  return useQuery({
    queryKey: ['integrations'],
    queryFn: listIntegrations,
    staleTime: 15_000,
  });
}

export function useStartConnect() {
  return useMutation({
    mutationFn: (input: ConnectInput) => startConnect(input),
  });
}

export function useSubmitBrokerKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ provider, apiKey, baseUrl }: { provider: string; apiKey: string; baseUrl?: string }) =>
      submitBrokerKey(provider, { apiKey, baseUrl }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['integrations'] }),
  });
}

export function useRevoke() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (provider: string) => revokeIntegration(provider),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['integrations'] }),
  });
}
