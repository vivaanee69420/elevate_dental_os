// Integrations API client. Owner-only on the backend; UI hides for non-owner.

import { api } from '@/lib/api';

export type AuthStyle = 'oauth' | 'broker_key' | 'platform';
export type IntegrationStatus = 'pending' | 'verifying' | 'active' | 'failed' | 'revoked';

export interface ProviderMeta {
  id: string;
  label: string;
  authStyle: AuthStyle;
  category: string;
}

export interface IntegrationRow {
  id: string;
  provider: string;
  status: IntegrationStatus;
  last_sync_at: string | null;
  last_error: string | null;
  config: Record<string, unknown>;
  verified_at: string | null;
  scopes: string[] | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface IntegrationsListResponse {
  integrations: IntegrationRow[];
  available: ProviderMeta[];
}

export function listIntegrations() {
  return api<IntegrationsListResponse>('/api/integrations');
}

export interface ConnectInput {
  provider: string;
  apiKey?: string;
  baseUrl?: string;
}

export interface ConnectResponse {
  redirectUrl?: string;
  pasteHint?: string;
  requiresKeyPaste?: boolean;
  requiresLocationId?: boolean; // GHL: prompt for a Location ID alongside the key
  dnsRecords?: Array<{ host: string; type: string; value: string }>;
}

export function startConnect(input: ConnectInput) {
  return api<ConnectResponse>('/api/integrations/connect', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function submitBrokerKey(provider: string, body: { apiKey: string; baseUrl?: string; locationId?: string }) {
  return api<{ ok: boolean }>(`/api/integrations/${provider}/callback`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function revokeIntegration(provider: string) {
  return api(`/api/integrations/${provider}/revoke`, { method: 'POST' });
}

// On-demand pull for a connected provider (Dentally/Xero/GoHighLevel). The
// first pull also fires automatically on connect, server-side.
export interface SyncResponse {
  ok: boolean;
  provider: string;
  [k: string]: unknown;
}

// Dentally collections that a scoped pull can target. Omitting `resources`
// (or passing all) pulls everything — the default backfill.
export type DentallySyncResource = 'patients' | 'appointments' | 'payments' | 'treatment_plans' | 'invoices';

export function syncIntegration(provider: string, full = false, resources?: DentallySyncResource[]) {
  const qs = full ? '?full=true' : '';
  const body = resources && resources.length ? JSON.stringify({ resources }) : undefined;
  return api<SyncResponse>(`/api/integrations/${provider}/sync${qs}`, { method: 'POST', body });
}

// Global "Refresh all": fire an incremental pull for every connected provider
// (Dentally, GoHighLevel, Google Ads, Meta Ads, QuickBooks). Latest data only,
// never a full backfill. Returns the providers that started.
export interface SyncAllResponse {
  started: string[];
}

export function syncAllIntegrations() {
  return api<SyncAllResponse>('/api/integrations/sync-all', { method: 'POST' });
}

export interface DetectedSiteId {
  site_id: string;
  count: number;
  name: string | null; // human name from Dentally /sites, when available
}

export function detectSiteIds(provider: string) {
  return api<{ siteIds: DetectedSiteId[]; error?: string }>(
    `/api/integrations/${provider}/site-ids`,
  );
}

export interface SyncProgress {
  running: boolean;
  pct: number;
  phase: string;
  done?: boolean;
  error?: string | null;
  page?: number;
  totalPages?: number | null;
  count?: number; // records fetched so far in the current phase
  at?: number; // server epoch ms of the last progress write — used to detect a stalled/lost sync
  // Per-phase breakdown accumulated server-side (insertion order = pull order),
  // so the UI can show each resource's pull, not just the active phase.
  phases?: Record<string, SyncPhaseProgress>;
  // True when phases run concurrently (each tracks its own pct + done flag); the
  // UI then uses per-phase `done` for completion instead of sequential position.
  parallel?: boolean;
}

export interface SyncPhaseProgress {
  phase: string;
  count: number;
  pct: number; // this phase's OWN progress (0-100), independent of other phases
  page: number;
  totalPages: number | null;
  done?: boolean; // explicit completion — set when a phase finishes (parallel-safe)
}

export function getSyncProgress(provider: string) {
  return api<SyncProgress>(`/api/integrations/${provider}/sync-progress`);
}

// --- Practice → Dentally site-id mapping ------------------------------------
// Synced appointments/payments need a practice_id; the Dentally site_id is
// matched to a practice via practices.pms_site_id. Unmapped → those rows are
// skipped (patients still sync).
export interface PracticeRow {
  id: string;
  name: string;
  pms_site_id: string | null;
}

export function listPractices() {
  return api<{ practices: PracticeRow[] }>('/api/practices');
}

export function setPracticeSiteId(id: string, pms_site_id: string | null) {
  return api(`/api/practices/${id}/pms-site-id`, {
    method: 'PATCH',
    body: JSON.stringify({ pms_site_id }),
  });
}

export function createPractice(body: { name: string; pms_site_id?: string; chairs?: number }) {
  return api<PracticeRow>('/api/practices', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// --- Real-time webhook config (Dentally) ------------------------------------
export interface WebhookLive {
  available: boolean; // false when the API key can't read webhooks (e.g. 403)
  registered?: boolean;
  status?: 'delivering' | 'disabled' | 'failing' | 'idle' | 'unregistered';
  active?: boolean;
  failedDeliveries?: number;
  successfulDeliveries?: number;
  lastDeliveredAt?: string | null;
  reason?: string;
}

export interface WebhookInfo {
  provider: string;
  url: string;
  configured: boolean; // true once a verifying secret is set
  live?: WebhookLive | null; // live provider-side status (best-effort)
}

export function getWebhookInfo(provider: string) {
  return api<WebhookInfo>(`/api/integrations/${provider}/webhook-info`);
}

export function setWebhookSecret(provider: string, secret: string) {
  return api<{ ok: boolean; configured: boolean }>(
    `/api/integrations/${provider}/webhook-secret`,
    { method: 'POST', body: JSON.stringify({ secret }) },
  );
}

// --- GoHighLevel pipeline stage mapping -------------------------------------
// The owner maps each GHL pipeline stage -> an Elevate lead status; until set,
// the sync falls back to a name heuristic (see backend mapStage).
export interface GhlStage {
  id: string;
  name: string;
}
export interface GhlPipeline {
  id: string;
  name: string;
  stages: GhlStage[];
}

export function detectPipelines(provider: string) {
  return api<{ pipelines: GhlPipeline[]; error?: string }>(
    `/api/integrations/${provider}/pipelines`,
  );
}

export function setStageMappings(provider: string, mappings: Record<string, string>) {
  return api<{ ok: boolean; stage_mappings: Record<string, string> }>(
    `/api/integrations/${provider}/stage-mappings`,
    { method: 'POST', body: JSON.stringify({ mappings }) },
  );
}

// --- Ad account selection (Google Ads / Meta Ads) ---------------------------
// Each provider discovers every reachable ad account; the owner picks which are
// included in the marketing views. Selection is org-isolated; default = all.
export interface AdAccount {
  provider: string;
  customer_id: string;
  name: string | null;
  currency: string | null;
  status: string | null;
  is_selected: boolean;
}

export function listAdAccounts(provider: string) {
  return api<AdAccount[]>(`/api/integrations/${provider}/ad-accounts`);
}

export function setAdAccountSelection(provider: string, selectedIds: string[]) {
  return api<{ ok: boolean; accounts: AdAccount[] }>(
    `/api/integrations/${provider}/ad-accounts/selection`,
    { method: 'POST', body: JSON.stringify({ selected_ids: selectedIds }) },
  );
}

// --- GoHighLevel subaccounts (multi-location) -------------------------------
// Each subaccount = one GHL Location (one per org). Owner-only.
export interface GhlAccount {
  id: string;
  external_account_id: string;     // GHL locationId
  label: string | null;
  status: IntegrationStatus;
  last_sync_at: string | null;
  last_error: string | null;
  config: Record<string, unknown>;
  webhook_token: string | null;
  webhook_url: string | null;
  created_at: string;
  updated_at: string;
  practice_id: string | null;
}

export function listGhlAccounts() {
  return api<{ accounts: GhlAccount[] }>('/api/integrations/gohighlevel/accounts');
}

export function addGhlAccount(body: { token: string; locationId: string; label?: string }) {
  return api<GhlAccount>('/api/integrations/gohighlevel/accounts', {
    method: 'POST', body: JSON.stringify(body),
  });
}

export function updateGhlAccount(id: string, body: { label?: string }) {
  return api<GhlAccount>(`/api/integrations/gohighlevel/accounts/${id}`, {
    method: 'PATCH', body: JSON.stringify(body),
  });
}

export function removeGhlAccount(id: string) {
  return api<{ ok: boolean }>(`/api/integrations/gohighlevel/accounts/${id}`, { method: 'DELETE' });
}

export function syncGhlAccount(id: string, full = false) {
  return api<{ started: boolean; accountId: string; full: boolean }>(
    `/api/integrations/gohighlevel/accounts/${id}/sync${full ? '?full=true' : ''}`,
    { method: 'POST' },
  );
}

export function detectAccountPipelines(id: string) {
  return api<{ pipelines: GhlPipeline[]; error?: string }>(
    `/api/integrations/gohighlevel/accounts/${id}/pipelines`,
  );
}

export function setAccountStageMappings(id: string, mappings: Record<string, string>) {
  return api<{ ok: boolean; stage_mappings: Record<string, string> }>(
    `/api/integrations/gohighlevel/accounts/${id}/stage-mappings`,
    { method: 'POST', body: JSON.stringify({ mappings }) },
  );
}

// --- QuickBooks companies (multi-account) -----------------------------------
// Each company = one QBO realm (connected via OAuth). Owner-only. No practice
// mapping — a QB company is an independent entity.
export interface QboAccount {
  id: string;
  realm_id: string | null;
  company_name: string | null;
  label: string | null;
  status: IntegrationStatus;
  last_sync_at: string | null;
  last_error: string | null;
  created_at: string;
}

export function listQboAccounts() {
  return api<{ accounts: QboAccount[] }>('/api/integrations/quickbooks/accounts');
}

// Returns the Intuit OAuth redirect URL; the caller sends the browser there.
export function connectQboAccount() {
  return api<{ redirectUrl: string }>('/api/integrations/quickbooks/accounts/connect', {
    method: 'POST',
  });
}

export function syncQboAccount(id: string, full = false) {
  return api<{ started: boolean; accountId: string; full: boolean }>(
    `/api/integrations/quickbooks/accounts/${id}/sync${full ? '?full=true' : ''}`,
    { method: 'POST' },
  );
}

export function removeQboAccount(id: string) {
  return api<{ ok: boolean }>(`/api/integrations/quickbooks/accounts/${id}`, { method: 'DELETE' });
}

// --- Emergent Practice Mapping ----------------------------------------------
export interface EmergentPracticeMapRow {
  business_id: string;
  business_name: string | null;
  practice_id: string | null;
}

export function getEmergentPractices() {
  return api<{ connected: boolean; businesses: EmergentPracticeMapRow[]; practices: PracticeRow[] }>('/api/integrations/emergent/practices');
}

export function setEmergentPractice(businessId: string, practiceId: string | null) {
  return api<{ connected: boolean; businesses: EmergentPracticeMapRow[]; practices: PracticeRow[]; restamped: number }>('/api/integrations/emergent/practices', {
    method: 'POST',
    body: JSON.stringify({ business_id: businessId, practice_id: practiceId }),
  });
}
