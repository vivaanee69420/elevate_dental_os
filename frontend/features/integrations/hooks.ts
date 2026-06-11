import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listIntegrations,
  startConnect,
  revokeIntegration,
  submitBrokerKey,
  syncIntegration,
  syncAllIntegrations,
  detectSiteIds,
  getSyncProgress,
  listPractices,
  setPracticeSiteId,
  createPractice,
  getWebhookInfo,
  setWebhookSecret,
  detectPipelines,
  setStageMappings,
  listAdAccounts,
  setAdAccountSelection,
  type ConnectInput,
  type DentallySyncResource,
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
    mutationFn: ({ provider, apiKey, baseUrl, locationId }: { provider: string; apiKey: string; baseUrl?: string; locationId?: string }) =>
      submitBrokerKey(provider, { apiKey, baseUrl, locationId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['integrations'] }),
  });
}

export function useRevoke() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (provider: string) => revokeIntegration(provider),
    onSuccess: () => {
      // Disconnect hides the provider's data server-side; refresh every surface
      // that reads it so the UI reflects the hide immediately.
      for (const key of [
        ['integrations'], ['business-hub'], ['cashflow'], ['payments'],
        ['payment-summary'], ['practices'], ['finance-series'], ['financial'],
        ['marketing-roi'], ['reviews'], ['leads'], ['appointments'],
        ['growth'], ['overview'],
      ]) {
        qc.invalidateQueries({ queryKey: key });
      }
    },
  });
}

export function useSyncIntegration() {
  const qc = useQueryClient();
  return useMutation({
    // full=true re-pulls the whole window (backfill after mapping practices).
    // resources scopes the pull to specific Dentally collections (e.g. patients
    // only); omitted = pull everything.
    mutationFn: ({ provider, full = false, resources }: { provider: string; full?: boolean; resources?: DentallySyncResource[] }) =>
      syncIntegration(provider, full, resources),
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

// Global "Refresh all" — fires an incremental pull across every connected
// provider. Pulls run fire-and-forget server-side, so the caller is responsible
// for refreshing data surfaces after a settle delay (see GlobalRefresh).
export function useSyncAll() {
  return useMutation({
    mutationFn: () => syncAllIntegrations(),
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

// GoHighLevel pipelines + stages (drives the stage-mapping UI).
export function usePipelines(provider: string, enabled = true) {
  return useQuery({
    queryKey: ['ghl-pipelines', provider],
    queryFn: () => detectPipelines(provider),
    enabled,
    staleTime: 60_000,
  });
}

export function useSetStageMappings(provider: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (mappings: Record<string, string>) => setStageMappings(provider, mappings),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['integrations'] }),
  });
}

// Ad accounts (Google Ads / Meta Ads) + selection persistence.
export function useAdAccounts(provider: string, enabled = true) {
  return useQuery({
    queryKey: ['ad-accounts', provider],
    queryFn: () => listAdAccounts(provider),
    enabled,
    staleTime: 30_000,
  });
}

export function useSetAdAccountSelection(provider: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (selectedIds: string[]) => setAdAccountSelection(provider, selectedIds),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ad-accounts', provider] });
      // Marketing views read the selected accounts — refresh them.
      qc.invalidateQueries({ queryKey: ['growth', 'marketing-roi'] });
      qc.invalidateQueries({ queryKey: ['growth', 'ad-spend'] });
      qc.invalidateQueries({ queryKey: ['marketing-roi'] });
      qc.invalidateQueries({ queryKey: ['business-hub'] });
    },
  });
}
