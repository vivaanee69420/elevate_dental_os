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
}

export function fetchCommunications(
  filters: CommunicationsListFilters = {},
): Promise<CommunicationsListResponse> {
  const params = new URLSearchParams();
  if (filters.contact_id) params.set('contact_id', filters.contact_id);
  if (filters.lead_id) params.set('lead_id', filters.lead_id);
  if (filters.channel) params.set('channel', filters.channel);
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
