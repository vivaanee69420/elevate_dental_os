import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listIntegrations,
  startConnect,
  revokeIntegration,
  submitBrokerKey,
  syncIntegration,
  detectSiteIds,
  getSyncProgress,
  listPractices,
  setPracticeSiteId,
  createPractice,
  getWebhookInfo,
  setWebhookSecret,
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

export function useSyncIntegration() {
  const qc = useQueryClient();
  return useMutation({
    // full=true re-pulls the whole window (backfill after mapping practices).
    mutationFn: ({ provider, full = false }: { provider: string; full?: boolean }) =>
      syncIntegration(provider, full),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['integrations'] });
      // Synced rows feed these screens — refresh them after a pull.
      qc.invalidateQueries({ queryKey: ['business-hub'] });
      qc.invalidateQueries({ queryKey: ['cashflow'] });
      qc.invalidateQueries({ queryKey: ['payments'] });
      qc.invalidateQueries({ queryKey: ['payment-summary'] });
    },
  });
}

export function useDetectSiteIds(provider: string) {
  return useMutation({ mutationFn: () => detectSiteIds(provider) });
}

// Polls live sync progress (in-memory on the server) ~1/s while enabled.
export function useSyncProgress(provider: string, enabled = true) {
  return useQuery({
    queryKey: ['sync-progress', provider],
    queryFn: () => getSyncProgress(provider),
    enabled,
    refetchInterval: enabled ? 1000 : false,
  });
}

// Invalidate everything a completed sync feeds.
export function useFinishSync() {
  const qc = useQueryClient();
  return () => {
    for (const key of [['integrations'], ['business-hub'], ['cashflow'], ['payments'], ['payment-summary'], ['practices'], ['finance-series'], ['financial']]) {
      qc.invalidateQueries({ queryKey: key });
    }
  };
}

export function useCreatePractice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; pms_site_id?: string; chairs?: number }) =>
      createPractice(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['practices'] }),
  });
}

export function usePractices() {
  return useQuery({ queryKey: ['practices'], queryFn: listPractices });
}

export function useSetPracticeSiteId() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, pms_site_id }: { id: string; pms_site_id: string | null }) =>
      setPracticeSiteId(id, pms_site_id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['practices'] }),
  });
}

export function useWebhookInfo(provider: string, enabled = true) {
  return useQuery({
    queryKey: ['webhook-info', provider],
    queryFn: () => getWebhookInfo(provider),
    enabled,
  });
}

export function useSetWebhookSecret(provider: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (secret: string) => setWebhookSecret(provider, secret),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['webhook-info', provider] }),
  });
}
