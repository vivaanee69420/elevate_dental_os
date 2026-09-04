// Integrations API client. Owner-only on the backend; UI hides for non-owner.

import { api } from '@/lib/api';

export type AuthStyle = 'oauth' | 'broker_key' | 'platform' | 'oauth_or_key';
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
  method?: 'oauth' | 'key';
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

// Outcome of the most recent inbound delivery. Updates on the very next event,
// before the provider's cumulative counters flip — the leading indicator that a
// corrected secret actually works.
export interface WebhookLastResult {
  outcome: 'verified' | 'bad_signature' | 'no_secret';
  at: string; // ISO timestamp of that delivery
  lenMatch?: boolean; // bad_signature only: false => encoding/format, true => value mismatch
  sigPresent?: boolean;
}

export interface WebhookInfo {
  provider: string;
  url: string;
  configured: boolean; // true once a verifying secret is set
  live?: WebhookLive | null; // live provider-side status (best-effort)
  lastResult?: WebhookLastResult | null;
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
  id: string;
  provider: string;
  customer_id: string;
  name: string | null;
  currency: string | null;
  status: string | null;
  is_selected: boolean;
  practice_id: string | null;
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

// Map an ad account to a practice so its spend splits below group level.
// Same endpoint as the Settings -> Ad attribution page (Step 3).
export function setAdAccountPractice(id: string, practiceId: string | null) {
  return api<{ ok: true }>(`/api/ad-attribution/ad-accounts/${id}`, {
    method: 'PATCH', body: JSON.stringify({ practice_id: practiceId }),
  });
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

// --- GoHighLevel daily WhatsApp report ---------------------------------------
// Owner-only. The raw webhook URL is never returned by the API — only a masked
// version — so the UI never round-trips it back into a text field.
export type DailyReportSettings = {
  webhookUrlMasked: string | null;
  configured: boolean;
  enabled: boolean;
  lastSentAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
};

export function getDailyReportSettings() {
  return api<{ settings: DailyReportSettings | null }>('/api/integrations/gohighlevel/daily-report');
}

// `webhookUrl` is optional: the backend accepts a toggle-only save (enable/
// disable) when a settings row already exists, so an owner who has lost the
// URL can still pause the report without re-pasting it. Omitting it with no
// existing row is rejected server-side with a 400.
export function saveDailyReportSettings(body: { webhookUrl?: string; enabled: boolean }) {
  return api<{ settings: DailyReportSettings }>('/api/integrations/gohighlevel/daily-report', {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

export function previewDailyReport() {
  return api<{ line: string; length: number; payload: Record<string, unknown> }>(
    '/api/integrations/gohighlevel/daily-report/preview',
    { method: 'POST' },
  );
}

export function sendDailyReport() {
  return api<{ sent: boolean; status: string; reason?: string }>(
    '/api/integrations/gohighlevel/daily-report/send',
    { method: 'POST' },
  );
}

// --- GHL -> Dentally conversion export (Google Sheets writer) --------------
// Records each new patient's first appointment in a Google Sheet when it
// matches a GoHighLevel pipeline lead. One connection, one destination sheet
// (one tab per practice). Owner-only.
export interface SheetsWriterCounts {
  pending: number;
  processing: number;
  exported: number;
  no_match: number;
  failed: number;
  skipped: number;
}

export interface SheetsWriterStatus {
  connected: boolean;
  status: IntegrationStatus | null;
  spreadsheetId: string | null;
  exportSince: string | null;
  lastError: string | null;
  counts: SheetsWriterCounts | null;
}

export function getSheetsWriterStatus() {
  return api<SheetsWriterStatus>('/api/integrations/google-sheets-writer/status');
}

export function setSheetsWriterDestination(url: string) {
  return api<{ spreadsheetId: string; exportSince: string | null }>(
    '/api/integrations/google-sheets-writer/destination',
    { method: 'POST', body: JSON.stringify({ url }) },
  );
}

export interface SheetsWriterDrainResult {
  exported?: number;
  noMatch?: number;
  retried?: number;
  excluded?: number;
  skippedDuplicates?: number;
  skipped?: 'not_connected' | 'no_destination' | 'integration_failed';
}

export function drainSheetsWriter() {
  return api<SheetsWriterDrainResult>('/api/integrations/google-sheets-writer/drain', {
    method: 'POST',
  });
}

export function disconnectSheetsWriter() {
  return api<{ ok: boolean }>('/api/integrations/google-sheets-writer', { method: 'DELETE' });
}

export interface SheetsWriterActivityEntry {
  id: string;
  name: string;
  practice: string;
  status: 'pending' | 'processing' | 'exported' | 'no_match' | 'failed' | 'skipped';
  reason: string | null;
  appointmentAt: string | null;
  at: string;
}

export function getSheetsWriterActivity() {
  return api<{ entries: SheetsWriterActivityEntry[] }>(
    '/api/integrations/google-sheets-writer/activity',
  );
}

// --- CallRail companies (multi-company call tracking) -----------------------
// CallRail tracks the phone calls each Google Ads campaign drives, so a call
// can be credited back to the ad that produced it. One CallRail company = one
// API key, mapped 1:1 to a practice — the same shape as a GHL subaccount. The
// first company added IS the connection; there is no separate singleton
// key-paste route, and there is no owner-maintained tracking-number map — a
// call's practice follows from the company (API key) that fetched it.
//
// CallRail's hierarchy is Account -> Company -> Calls: callrailAccountId is
// the CallRail ACCOUNT id, callrailCompanyId is the CallRail COMPANY id —
// deliberately both surfaced rather than conflated (that conflation was the
// root defect an earlier version of this integration shipped with). The
// Add-company flow is KEY-ONLY DISCOVERY: the owner pastes ONE API key (which
// may cover several CallRail accounts — an agency-style key), the backend
// resolves EVERY account and company it can reach (discoverCallRailAccounts),
// and the owner ticks the companies to connect in one request
// (bulkConnectCallRailAccounts) — no account id is ever typed by hand.
export interface CallRailAccount {
  id: string;
  label: string | null;
  callrailAccountId: string;
  callrailCompanyId: string;
  practiceId: string | null;
  practiceName: string | null;
  status: IntegrationStatus;
  lastSyncedAt: string | null;
  lastError: string | null;
  webhookUrl: string | null;
  // Never the key itself — just whether one is on file, so the panel can say
  // honestly whether webhook signature verification is active for this
  // company or deliveries are accepted on the URL token alone.
  signingKeyConfigured: boolean;
  callCount: number;
  lastCallAt: string | null;
}

// What CallRail itself attributes a call to (e.g. a Google Ads campaign vs.
// organic/direct) — shown so the "every tracked call is an ad call" working
// assumption is checkable against real data rather than permanent and invisible.
// `source` is genuinely nullable — CallRail returns null for some calls, and
// the backend passes that through unchanged (see callrailRepository.sourceBreakdown).
export interface CallRailSourceBreakdown {
  source: string | null;
  callCount: number;
}

export interface CallRailStatus {
  connected: boolean;
  accounts: CallRailAccount[];
  sourceBreakdown: CallRailSourceBreakdown[];
}

export function getCallRailStatus() {
  return api<CallRailStatus>('/api/integrations/callrail');
}

// Add-company step 1 (key-only discovery): ONE API key reveals every account
// and company it can reach — no account id typed by hand. POST (never
// GET+query) — the API key belongs in a body, not a URL. Nothing is
// persisted by this call.
export interface CallRailDiscoveredCompany {
  id: string;
  name: string;
  alreadyConnected: boolean;
}
export interface CallRailDiscoveredAccount {
  accountId: string;
  accountName: string;
  companies: CallRailDiscoveredCompany[];
  // Present only when THIS account's companies lookup failed — the other
  // discovered accounts are unaffected (see callrailService.discoverAccounts).
  error?: string;
}
export function discoverCallRailAccounts(body: { apiKey: string }) {
  return api<{ accounts: CallRailDiscoveredAccount[] }>('/api/integrations/callrail/discover', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// Add-company step 2: connect several discovered companies in one request.
// One shared apiKey (CallRail keys aren't per-company) + a per-entry
// accountId/companyId/label/practiceId. practiceId is omitted, not just
// nulled, on any entry for a non-agency-actor caller: the backend rejects
// practiceId anywhere in this body entirely unless the caller is an agency
// actor (same rule as GHL account update's practice_id field), so the key
// must not be present in the JSON at all — see CallRailPanel's submitConnect.
export interface CallRailBulkConnectEntry {
  accountId: string;
  companyId: string;
  label?: string;
  practiceId?: string | null;
}
export interface CallRailBulkConnectResult {
  companyId: string;
  ok: boolean;
  account?: CallRailAccount;
  error?: string;
}
export function bulkConnectCallRailAccounts(body: { apiKey: string; companies: CallRailBulkConnectEntry[] }) {
  return api<{ results: CallRailBulkConnectResult[] }>('/api/integrations/callrail/accounts/bulk', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// practiceId is omitted, not just nulled, for a non-agency-actor caller: the
// backend rejects practiceId on this body entirely unless the caller is an
// agency actor (same rule as GHL account update's practice_id field), so the
// key must not be present in the JSON at all — see CallRailPanel's submitAdd.
export function addCallRailAccount(body: {
  apiKey: string;
  callrailAccountId: string;
  callrailCompanyId: string;
  label: string;
  practiceId?: string | null;
}) {
  return api<CallRailAccount>('/api/integrations/callrail/accounts', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// apiKey (rotation) and signingKey are both ordinary owner self-service, NOT
// agency-gated — only practiceId is. `signingKey: null` clears a
// previously-set key; omit it entirely to leave it untouched.
export function updateCallRailAccount(id: string, body: {
  practiceId?: string | null;
  label?: string;
  apiKey?: string;
  signingKey?: string | null;
}) {
  return api<CallRailAccount>(`/api/integrations/callrail/accounts/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export function removeCallRailAccount(id: string) {
  return api<{ removed: true }>(`/api/integrations/callrail/accounts/${id}`, { method: 'DELETE' });
}

// Manual per-company sync — pulls the wide (183-day) window, not the
// incremental nightly one. `truncated` is true only if the pagination safety
// cap was hit with more data still waiting (effectively never in practice).
export function syncCallRailAccount(id: string) {
  return api<{ ingested: number; truncated: boolean }>(`/api/integrations/callrail/accounts/${id}/sync`, { method: 'POST' });
}

// Every company, one call, each over the incremental window.
export function syncAllCallRail() {
  return api<{ ingested: number }>('/api/integrations/callrail/sync', { method: 'POST' });
}

// Disconnects the provider and every company beneath it.
export function disconnectCallRail() {
  return api<{ connected: false }>('/api/integrations/callrail', { method: 'DELETE' });
}

// --- Emergent (Treatments Accepted) ----------------------------------------
// The Emergent panel loads this same endpoint for its own form state; the
// tile needs it too, so the shape lives here and both read one cached query.
export interface EmergentStatus {
  connected: boolean;
  status: string | null;
  baseUrl: string | null;
  keyHint: string | null;
  webhookUrl: string | null;
  webhookSecretSet: boolean;
  lastSyncAt: string | null;
}

export function getEmergentStatus() {
  return api<EmergentStatus>('/api/integrations/emergent');
}
