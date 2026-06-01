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
  dnsRecords?: Array<{ host: string; type: string; value: string }>;
}

export function startConnect(input: ConnectInput) {
  return api<ConnectResponse>('/api/integrations/connect', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function submitBrokerKey(provider: string, body: { apiKey: string; baseUrl?: string }) {
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

export function syncIntegration(provider: string, full = false) {
  const qs = full ? '?full=true' : '';
  return api<SyncResponse>(`/api/integrations/${provider}/sync${qs}`, { method: 'POST' });
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
export interface WebhookInfo {
  provider: string;
  url: string;
  configured: boolean; // true once a verifying secret is set
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
