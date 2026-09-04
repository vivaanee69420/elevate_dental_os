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
  setAdAccountPractice,
  listGhlAccounts,
  addGhlAccount,
  updateGhlAccount,
  removeGhlAccount,
  syncGhlAccount,
  getEmergentPractices,
  setEmergentPractice,
  getDailyReportSettings,
  saveDailyReportSettings,
  previewDailyReport,
  sendDailyReport,
  getSheetsWriterStatus,
  setSheetsWriterDestination,
  drainSheetsWriter,
  disconnectSheetsWriter,
  getSheetsWriterActivity,
  getCallRailStatus,
  discoverCallRailAccounts,
  bulkConnectCallRailAccounts,
  addCallRailAccount,
  updateCallRailAccount,
  removeCallRailAccount,
  syncCallRailAccount,
  syncAllCallRail,
  disconnectCallRail,
  type ConnectInput,
  type DentallySyncResource,
  type CallRailBulkConnectEntry,
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
    // Poll modestly so the owner can fire a test from the provider and watch the
    // status flip to verified within seconds — the whole point of the
    // loop-closing diagnostic. 15s keeps the live provider-side health call
    // (a Dentally GET /webhooks) well under any rate limit.
    refetchInterval: 15000,
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

export function useSetAdAccountPractice(provider: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, practiceId }: { id: string; practiceId: string | null }) =>
      setAdAccountPractice(id, practiceId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ad-accounts', provider] });
      // Per-practice spend/CPL reads ad_accounts.practice_id — refresh them all.
      qc.invalidateQueries({ queryKey: ['ad-attribution-config'] });
      qc.invalidateQueries({ queryKey: ['ad-performance'] });
      qc.invalidateQueries({ queryKey: ['growth', 'marketing-roi'] });
      qc.invalidateQueries({ queryKey: ['growth', 'ad-spend'] });
      qc.invalidateQueries({ queryKey: ['marketing-roi'] });
      qc.invalidateQueries({ queryKey: ['business-hub'] });
    },
  });
}

// GoHighLevel multi-subaccount management.
export function useGhlAccounts() {
  return useQuery({
    queryKey: ['ghl-accounts'],
    queryFn: listGhlAccounts,
    staleTime: 30_000,
  });
}

export function useAddGhlAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { token: string; locationId: string; label?: string }) =>
      addGhlAccount(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ghl-accounts'] }),
  });
}

export function useUpdateGhlAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; label?: string }) =>
      updateGhlAccount(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ghl-accounts'] }),
  });
}

export function useRemoveGhlAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => removeGhlAccount(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ghl-accounts'] }),
  });
}

export function useSyncGhlAccount() {
  return useMutation({
    mutationFn: ({ id, full }: { id: string; full?: boolean }) => syncGhlAccount(id, full),
  });
}

// --- Emergent Practice Mapping ----------------------------------------------
export function useEmergentPractices() {
  return useQuery({
    queryKey: ['emergent-practices'],
    queryFn: getEmergentPractices,
    staleTime: 30_000,
  });
}

export function useSetEmergentPractice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ businessId, practiceId }: { businessId: string; practiceId: string | null }) =>
      setEmergentPractice(businessId, practiceId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['emergent-practices'] });
      // Refresh treatment_accepted surfaces since re-stamp may change counts
      qc.invalidateQueries({ queryKey: ['marketing-roi'] });
      qc.invalidateQueries({ queryKey: ['growth', 'marketing-roi'] });
      qc.invalidateQueries({ queryKey: ['business-hub'] });
    },
  });
}

// --- GoHighLevel daily WhatsApp report ---------------------------------------
export function useDailyReportSettings() {
  return useQuery({
    queryKey: ['daily-report-settings'],
    queryFn: getDailyReportSettings,
    staleTime: 30_000,
  });
}

export function useSaveDailyReportSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { webhookUrl?: string; enabled: boolean }) => saveDailyReportSettings(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['daily-report-settings'] }),
  });
}

export function usePreviewDailyReport() {
  return useMutation({ mutationFn: previewDailyReport });
}

export function useSendDailyReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: sendDailyReport,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['daily-report-settings'] }),
  });
}

// --- GHL -> Dentally conversion export (Google Sheets writer) --------------
export function useSheetsWriterStatus() {
  return useQuery({
    queryKey: ['sheets-writer-status'],
    queryFn: getSheetsWriterStatus,
    staleTime: 15_000,
  });
}

export function useSetSheetsWriterDestination() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (url: string) => setSheetsWriterDestination(url),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sheets-writer-status'] }),
  });
}

export function useDrainSheetsWriter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => drainSheetsWriter(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sheets-writer-status'] }),
  });
}

export function useDisconnectSheetsWriter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => disconnectSheetsWriter(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sheets-writer-status'] }),
  });
}

// Fetched only while the activity modal is open (enabled flag) — a rolling
// last-24h window of what the export checked.
export function useSheetsWriterActivity(enabled: boolean) {
  return useQuery({
    queryKey: ['sheets-writer-activity'],
    queryFn: getSheetsWriterActivity,
    enabled,
    staleTime: 15_000,
  });
}

// --- CallRail companies (multi-company call tracking) -----------------------
export function useCallRailStatus() {
  return useQuery({
    queryKey: ['callrail-status'],
    queryFn: getCallRailStatus,
    staleTime: 30_000,
  });
}

// Add-company step 1 (key-only discovery): not cached (deliberately not a
// useQuery) — a fresh lookup every time the owner clicks, and the API key
// never sits in the query cache.
export function useDiscoverCallRailAccounts() {
  return useMutation({
    mutationFn: (body: { apiKey: string }) => discoverCallRailAccounts(body),
  });
}

// Add-company step 2: connect several discovered companies in one request.
export function useBulkConnectCallRailAccounts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { apiKey: string; companies: CallRailBulkConnectEntry[] }) => bulkConnectCallRailAccounts(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['callrail-status'] }),
  });
}

export function useAddCallRailAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { apiKey: string; callrailAccountId: string; callrailCompanyId: string; label: string; practiceId?: string | null }) =>
      addCallRailAccount(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['callrail-status'] }),
  });
}

export function useUpdateCallRailAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; practiceId?: string | null; label?: string; apiKey?: string; signingKey?: string | null }) =>
      updateCallRailAccount(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['callrail-status'] }),
  });
}

export function useRemoveCallRailAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => removeCallRailAccount(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['callrail-status'] }),
  });
}

export function useSyncCallRailAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => syncCallRailAccount(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['callrail-status'] }),
  });
}

// "Sync now — every company".
export function useSyncAllCallRail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => syncAllCallRail(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['callrail-status'] }),
  });
}

export function useDisconnectCallRail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => disconnectCallRail(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['callrail-status'] }),
  });
}
