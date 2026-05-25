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
