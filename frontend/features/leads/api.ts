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
  ghl_pipeline_stage_id: string | null;
  ghl_stage_name: string | null;
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
  // Optional joined practice (id + name) when backend returns it.
  practice?: { id: string; name: string } | null;
}

export interface LeadsListResponse {
  leads: Lead[];
}

export interface LeadsListFilters {
  status?: LeadStatus;
  practice_id?: string;
  integration_account_id?: string;
  assigned_to?: string;
  since?: string;
  ghl_pipeline_id?: string;
  limit?: number;
}

export function listLeads(filters: LeadsListFilters = {}): Promise<LeadsListResponse> {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.practice_id) params.set('practice_id', filters.practice_id);
  if (filters.integration_account_id) params.set('integration_account_id', filters.integration_account_id);
  if (filters.assigned_to) params.set('assigned_to', filters.assigned_to);
  if (filters.since) params.set('since', filters.since);
  if (filters.ghl_pipeline_id) params.set('ghl_pipeline_id', filters.ghl_pipeline_id);
  params.set('limit', String(filters.limit ?? 100));
  return api<LeadsListResponse>(`/api/leads?${params.toString()}`);
}

// ---------------------------------------------------------------------------
// CSV export — same-origin download href, exactly like the Data Room's
// `dataRoomExportUrl` (an <a download> that streams; NOT a fetch-and-blob
// path). Server-side, this pages through every matching row past
// PostgREST's 1000-row cap, so it never truncates a pipeline the way reading
// off the board's capped `listLeads` array would.
// ---------------------------------------------------------------------------
const PROXY = '/api/backend';

export interface LeadsExportFilters {
  ghl_pipeline_id?: string | null;
  integration_account_id?: string | null;
}

export function leadsExportUrl(filters: LeadsExportFilters = {}): string {
  const params = new URLSearchParams();
  if (filters.ghl_pipeline_id) params.set('ghl_pipeline_id', filters.ghl_pipeline_id);
  if (filters.integration_account_id) params.set('integration_account_id', filters.integration_account_id);
  return `${PROXY}/api/leads/export.csv?${params.toString()}`;
}

// GoHighLevel pipeline definitions (cached from the sync) — drives the dynamic
// Pipeline-screen columns + the pipeline selector.
export interface GhlPipelineStage {
  id: string;
  name: string;
}
export interface GhlPipeline {
  id: string;
  name: string;
  stages: GhlPipelineStage[];
  // Leads currently in this pipeline (backend orders the list busiest-first).
  lead_count?: number;
  value_pence?: number;
}

// Pipeline ids are per GHL Location — pass the selected subaccount so the
// selector only offers pipelines that subaccount's leads can actually be in.
export function listPipelines(accountId?: string | null) {
  const qs = accountId ? `?integration_account_id=${encodeURIComponent(accountId)}` : '';
  return api<{ pipelines: GhlPipeline[] }>(`/api/leads/pipelines${qs}`);
}

// ---------------------------------------------------------------------------
// Board figures, aggregated in SQL.
//
// The board used to sum a `limit: 500` page of leads in the browser. Measured
// on live data, a pipeline holding 2,092 leads worth £1,421,317 rendered
// "500 leads · £0.00" — every valued lead was older than that page.
//
// `value_pence` is NULL, never 0, when nothing in the bucket carries a value.
// Only 22.5% of this group's leads have an estimated value at all, so £0.00
// would state a fact nobody recorded. `valued_count` says what share of the
// bucket the money actually covers.
// ---------------------------------------------------------------------------
export interface PipelineStageSummary {
  stage_id: string | null;
  lead_count: number;
  valued_count: number;
  value_pence: number | null;
  open_count: number;
  open_valued_count: number;
  open_value_pence: number | null;
}

export type PipelineTotals = Omit<PipelineStageSummary, 'stage_id'>;

export interface PipelineSummary {
  stages: PipelineStageSummary[];
  /** null when no pipeline was asked for — not a zeroed board. */
  totals: PipelineTotals | null;
}

export function getPipelineSummary(opts: {
  pipelineId: string;
  accountId?: string | null;
}): Promise<PipelineSummary> {
  const params = new URLSearchParams({ ghl_pipeline_id: opts.pipelineId });
  if (opts.accountId) params.set('integration_account_id', opts.accountId);
  return api<PipelineSummary>(`/api/leads/pipeline-summary?${params.toString()}`);
}

// ---------------------------------------------------------------------------
// Enquiries.
//
// No `treatment` field, deliberately. The screen this replaces showed one read
// from leads.treatment, which is GoHighLevel's raw opportunity name and carries
// patient names, emails and phone numbers. The honest source is Dentally's
// treatment-plan lines, which resolve for 0.7% of leads.
// ---------------------------------------------------------------------------
export interface Enquiry {
  lead_id: string;
  created_at: string;
  contact_first_name: string | null;
  contact_last_name: string | null;
  contact_email: string | null;
  stage_name: string | null;
  status: string;
  /** null when no value was recorded — never 0. */
  estimated_value_pence: number | null;
  source: string | null;
  /** null when the lead is not mapped to a practice. */
  practice_name: string | null;
  age_days: number;
}

export interface EnquiriesResponse {
  enquiries: Enquiry[];
  /** Enquiries matching the current filters — what the pager counts. */
  total: number;
  limit: number;
  offset: number;
  summary: {
    open_count: number;
    valued_count: number;
    /** null when nothing carries a value. */
    value_pence: number | null;
    stale_count: number;
    oldest_age_days: number;
  };
}

export interface EnquiriesFilters {
  accountId?: string | null;
  search?: string;
  stage?: string;
  valuedOnly?: boolean;
  openOnly?: boolean;
  limit?: number;
  offset?: number;
}

export function getEnquiries(f: EnquiriesFilters = {}): Promise<EnquiriesResponse> {
  const params = new URLSearchParams();
  if (f.accountId) params.set('integration_account_id', f.accountId);
  if (f.search) params.set('search', f.search);
  if (f.stage) params.set('stage', f.stage);
  if (f.valuedOnly) params.set('valued_only', 'true');
  if (f.openOnly === false) params.set('open_only', 'false');
  if (f.limit != null) params.set('limit', String(f.limit));
  if (f.offset != null) params.set('offset', String(f.offset));
  const qs = params.toString();
  return api<EnquiriesResponse>(`/api/leads/enquiries${qs ? `?${qs}` : ''}`);
}

export interface TodayCounters {
  new_leads: number;
  follow_ups: number;
  active_leads: number;
  inbound_messages: number;
}

export function getTodayCounters(opts: {
  since?: string | null;
  accountId?: string | null;
} = {}): Promise<TodayCounters> {
  const params = new URLSearchParams();
  if (opts.since) params.set('since', opts.since);
  if (opts.accountId) params.set('integration_account_id', opts.accountId);
  const qs = params.toString();
  return api<TodayCounters>(`/api/leads/today-counters${qs ? `?${qs}` : ''}`);
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

// ---------------------------------------------------------------------------
// Lead funnel — server-aggregated.
//
// Counts MUST come from here, never from slicing a page of `listLeads`. That
// list is capped (Zod default limit 100, ordered newest-first), so a funnel
// derived from it silently reports whatever the newest page happens to
// contain. On a real org that meant a permanent 0% conversion rate.
// ---------------------------------------------------------------------------
export interface LeadFunnelStage {
  key: string;
  label: string;
  count: number;
}

export interface LeadFunnel {
  total: number;
  started: number;
  lost: number;
  /** null when there are no leads to divide by — render "—", not "0%". */
  conversionPct: number | null;
  stages: LeadFunnelStage[];
}

export function getLeadFunnel(opts: {
  since?: string | null;
  until?: string | null;
  practiceId?: string | null;
} = {}) {
  const qs = new URLSearchParams();
  if (opts.since) qs.set('since', opts.since);
  if (opts.until) qs.set('until', opts.until);
  if (opts.practiceId) qs.set('practice_id', opts.practiceId);
  const q = qs.toString();
  return api<LeadFunnel>(`/api/leads/funnel${q ? `?${q}` : ''}`);
}

// ---------------------------------------------------------------------------
// CRM Reports — server-aggregated. Same rule as the funnel: every figure comes
// from one SQL aggregate over one window, never from counting a page of leads.
// ---------------------------------------------------------------------------
export interface LeadReportGroup {
  key: string;
  keyId: string | null;
  total: number;
  contacted: number;
  consultBooked: number;
  consultAttended: number;
  treatmentStarted: number;
  notProceeding: number;
  failedToAttend: number;
  convertedValuePence: number;
  pipelineValuePence: number;
  /** null when there are no leads to divide by. */
  conversionPct: number | null;
}

export interface LeadReport {
  totals: LeadReportGroup & {
    ftaPct: number | null;
    avgFirstResponseMinutes: number | null;
  };
  funnel: { key: string; label: string; count: number }[];
  bySource: LeadReportGroup[];
  byPractice: LeadReportGroup[];
}

export function getLeadReport(opts: {
  since?: string | null;
  until?: string | null;
  practiceId?: string | null;
  accountId?: string | null;
} = {}) {
  const qs = new URLSearchParams();
  if (opts.since) qs.set('since', opts.since);
  if (opts.until) qs.set('until', opts.until);
  if (opts.practiceId) qs.set('practice_id', opts.practiceId);
  if (opts.accountId) qs.set('integration_account_id', opts.accountId);
  const q = qs.toString();
  return api<LeadReport>(`/api/leads/report${q ? `?${q}` : ''}`);
}
