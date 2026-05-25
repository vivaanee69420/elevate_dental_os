// Leads API client. Mirrors backend/src/models/lead.model.js shapes.

import { api } from '@/lib/api';

export type LeadStatus =
  | 'new'
  | 'contact_attempted'
  | 'contact_made'
  | 'consultation_booked'
  | 'consultation_attended'
  | 'treatment_started'
  | 'treatment_completed'
  | 'not_proceeding'
  | 'failed_to_attend';

export interface Lead {
  id: string;
  organisation_id: string;
  contact_id: string;
  practice_id: string | null;
  treatment: string;
  estimated_value_pence: number;
  status: LeadStatus;
  assigned_to: string | null;
  source: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  last_response_minutes: number | null;
  expected_close_date: string | null;
  actual_close_date: string | null;
  // GoHighLevel sync. 'manual' = entered in Elevate; 'synced' = mastered by GHL.
  sync_status: 'synced' | 'manual' | 'pending_sync';
  ghl_opportunity_id: string | null;
  ghl_pipeline_id: string | null;
  created_at: string;
  updated_at: string;
  // Optional joined contact details when backend returns them
  contact?: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    phone: string | null;
  } | null;
}

export interface LeadsListResponse {
  leads: Lead[];
}

export interface LeadsListFilters {
  status?: LeadStatus;
  practice_id?: string;
  assigned_to?: string;
  since?: string;
  limit?: number;
}

export function listLeads(filters: LeadsListFilters = {}): Promise<LeadsListResponse> {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.practice_id) params.set('practice_id', filters.practice_id);
  if (filters.assigned_to) params.set('assigned_to', filters.assigned_to);
  if (filters.since) params.set('since', filters.since);
  params.set('limit', String(filters.limit ?? 100));
  return api<LeadsListResponse>(`/api/leads?${params.toString()}`);
}

export interface LeadUpdateInput {
  status?: LeadStatus;
  assigned_to?: string | null;
  estimated_value_pence?: number;
  treatment?: string;
  expected_close_date?: string;
}

export function updateLead(id: string, input: LeadUpdateInput) {
  return api<Lead>(`/api/leads/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}
