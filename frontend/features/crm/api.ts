// CRM API client. Typed wrappers over lib/api.ts. Same-origin proxy injects
// the Bearer token server-side; never store secrets in this layer.

import { api } from '@/lib/api';

export type Channel = 'email' | 'sms' | 'whatsapp' | 'call' | 'in_person';
export type Direction = 'inbound' | 'outbound';

export interface Communication {
  id: string;
  organisation_id: string;
  contact_id: string | null;
  lead_id: string | null;
  channel: Channel;
  direction: Direction;
  subject: string | null;
  body: string | null;
  from_address: string | null;
  to_address: string | null;
  delivery_status: string | null;
  read_at: string | null;
  external_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  // Joined contact (when linked) — used to show the real name in the Inbox
  // instead of the contact id.
  contact?: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
  } | null;
}

export interface CommunicationsListResponse {
  communications: Communication[];
}

export interface CommunicationsListFilters {
  contact_id?: string;
  lead_id?: string;
  channel?: Channel;
  integration_account_id?: string;
}

export function fetchCommunications(
  filters: CommunicationsListFilters = {},
): Promise<CommunicationsListResponse> {
  const params = new URLSearchParams();
  if (filters.contact_id) params.set('contact_id', filters.contact_id);
  if (filters.lead_id) params.set('lead_id', filters.lead_id);
  if (filters.channel) params.set('channel', filters.channel);
  if (filters.integration_account_id) params.set('integration_account_id', filters.integration_account_id);
  const qs = params.toString();
  return api<CommunicationsListResponse>(`/api/comms${qs ? `?${qs}` : ''}`);
}

export interface SendCommunicationInput {
  contact_id?: string;
  lead_id?: string;
  channel: 'email' | 'sms' | 'whatsapp';
  to: string;
  subject?: string;
  body: string;
}

export function sendCommunication(input: SendCommunicationInput) {
  return api<Communication>(`/api/comms/send`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// GoHighLevel automations (workflows) — id/name/status only (GHL's API doesn't
// expose per-workflow sent/conversion).
export interface GhlWorkflow {
  id: string;
  name: string;
  status: string | null;
  updatedAt: string | null;
}

export function fetchGhlWorkflows(accountId?: string | null) {
  const qs = accountId ? `?account_id=${accountId}` : '';
  return api<{ workflows: GhlWorkflow[] }>(`/api/workflows/ghl${qs}`);
}

// ---------------------------------------------------------------------------
// Inbox — server-aggregated conversations.
//
// The old Inbox fetched /api/comms (capped at 200 rows server-side) and then
// threaded, counted and searched that page in the browser. On live data it
// showed 105 of 12,764 conversations, and an unread badge of 10 against a true
// 5,753. These endpoints answer over the whole inbox instead.
// ---------------------------------------------------------------------------

export interface InboxThread {
  thread_key: string;
  contact_id: string | null;
  lead_id: string | null;
  channel: Channel;
  counterparty: string | null;
  contact_first_name: string | null;
  contact_last_name: string | null;
  last_at: string;
  last_subject: string | null;
  last_body: string | null;
  message_count: number;
  unread_count: number;
}

export interface InboxSummary {
  total_messages: number;
  total_threads: number;
  unread_messages: number;
  unread_threads: number;
}

export interface InboxResponse {
  threads: InboxThread[];
  /** Conversations matching the CURRENT filters — what a pager counts. */
  total: number;
  limit: number;
  offset: number;
  /** The whole inbox, regardless of filters — what the unread badge counts. */
  summary: InboxSummary;
}

export interface InboxFilters {
  integration_account_id?: string | null;
  search?: string;
  channel?: string;
  unread_only?: boolean;
  limit?: number;
  offset?: number;
}

export function fetchInbox(filters: InboxFilters = {}): Promise<InboxResponse> {
  const params = new URLSearchParams();
  if (filters.integration_account_id) params.set('integration_account_id', filters.integration_account_id);
  if (filters.search) params.set('search', filters.search);
  if (filters.channel) params.set('channel', filters.channel);
  if (filters.unread_only) params.set('unread_only', 'true');
  if (filters.limit != null) params.set('limit', String(filters.limit));
  if (filters.offset != null) params.set('offset', String(filters.offset));
  const qs = params.toString();
  // The "?" is added HERE and never baked into the query string. A helper that
  // returned "since=..&until=.." without one was interpolated raw elsewhere in
  // this codebase and produced
  // "/api/marketing/facebook/lead-performancesince=2026-09-01" — which 404s
  // silently into an empty state that reads as a design decision.
  return api<InboxResponse>(`/api/comms/inbox${qs ? `?${qs}` : ''}`);
}

export function fetchThread(threadKey: string): Promise<{ messages: Communication[] }> {
  return api<{ messages: Communication[] }>(
    `/api/comms/thread?thread_key=${encodeURIComponent(threadKey)}`,
  );
}
