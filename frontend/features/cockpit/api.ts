// frontend/features/cockpit/api.ts
// Daily Command Cockpit — a single daily-ops snapshot (revenue, treatment &
// close, Google/Facebook lead comparison, cash up, and the latest available
// monthly P&L) sourced from the Emergent till + lead-attribution matching.
// Money is integer pence throughout (rule 2).
import { api } from '@/lib/api';

export interface CockpitPracticeRevenue {
  practiceId: string | null;
  name: string | null;
  collectedPence: number;
}

export interface CockpitPracticeTreatment {
  practiceId: string | null;
  name: string | null;
  acceptedCount: number;
  acceptedValuePence: number;
  txPlansGiven: number;
  txPlanValuePence: number;
  newLeads: number;
  attended: number;
}

export interface CockpitPracticeCashUp {
  practiceId: string | null;
  name: string | null;
  collectedPence: number;
  detailPence: number;
  variancePence: number;
}

export interface CockpitBusinessMonthly {
  practiceId: string | null;
  name: string | null;
  revenuePence: number;
  netProfitPence: number;
}

// Pipeline -> channel classification. 'other' is the catch-all — never null.
export type LeadChannel = 'google' | 'facebook' | 'website' | 'instagram' | 'other';

export interface LeadRoiChannelRow {
  practiceId: string | null;
  practiceName: string | null;
  pipelineId: string | null;
  pipelineName: string | null;
  channel: LeadChannel;
  // `leads` counts PEOPLE (a contact in two pipelines of the same channel is
  // one lead); `entries` is the raw number of pipeline rows behind them.
  leads: number;
  entries: number;
  conversions: number;
  matchedValuePence: number;
}

export interface LeadRoiGroupStats {
  leads: number;
  entries: number;
  conversions: number;
  matchedValuePence: number;
  spendPence: number;
}

// GHL subaccounts with no practice mapping — an org can also connect academy /
// accounting locations, whose leads are not a practice's patient leads. They
// are excluded from the totals and reported here so they can be mapped (or
// knowingly ignored) rather than silently counted.
export interface LeadRoiUnmapped {
  leads: number;
  accounts: Array<{ accountId: string | null; label: string; leads: number }>;
}

// Org-wide, per-channel cost/lead + ROI — ad spend isn't practice-attributable,
// so these live at group level only, always org-wide (even when scoped to a
// practice). Null-guarded: cplPence null when leads=0, roi null when spend=0.
export interface ChannelRoi {
  leads: number;
  conversions: number;
  matchedValuePence: number;
  spendPence: number;
  cplPence: number | null;
  roi: number | null;
}

export interface LeadRoi {
  channels: LeadRoiChannelRow[];
  // Always org-wide, whatever the page is scoped to — the figure the scoped
  // number is compared against.
  group: {
    google: LeadRoiGroupStats;
    facebook: LeadRoiGroupStats;
  };
  // The selected practice's own totals; null when no practice is selected.
  scoped: {
    google: LeadRoiGroupStats;
    facebook: LeadRoiGroupStats;
  } | null;
  unmapped: LeadRoiUnmapped;
  spendByChannel: {
    google: number;
    facebook: number;
  };
  groupChannels: {
    google: ChannelRoi;
    facebook: ChannelRoi;
  };
}

export interface CockpitDailyRevenue {
  date: string;
  cashPence: number;
}

export interface PLLine {
  name: string;
  amountPence: number;
}

export interface PLLineNote {
  name: string;
  note: string;
}

export interface CockpitResponse {
  window: { since: string | null; until: string | null };
  revenue: {
    collectedPence: number;
    byPractice: CockpitPracticeRevenue[];
    dailySeries: CockpitDailyRevenue[];
  };
  treatment: {
    acceptedCount: number;
    acceptedValuePence: number;
    txPlansGiven: number;
    txPlanValuePence: number;
    newLeads: number;
    attended: number;
    byPractice: CockpitPracticeTreatment[];
  };
  leadRoi: LeadRoi;
  cashUp: {
    collectedPence: number;
    detailPence: number;
    variancePence: number;
    byPractice: CockpitPracticeCashUp[];
  };
  monthly: {
    periodMonth: string;
    revenuePence: number;
    netProfitPence: number;
    clinicianFeesPence: number;
    labOverheadPence: number;
    // revenue − clinician − labOverhead − netProfit. Non-zero means Emergent's
    // own P&L lines don't reconcile to the net profit it sent.
    residualPence: number;
    // null when revenue is 0 — a margin on no revenue is undefined, not 0%.
    marginPct: number | null;
    byBusiness: CockpitBusinessMonthly[];
    costLines: PLLine[];
    opexLines: PLLine[];
    customLines: PLLine[];
    lineNotes: PLLineNote[];
  };
  updatedAt: string;
}

export interface CockpitParams {
  since?: string;
  until?: string;
  scope?: string;
}

export function fetchCockpit(params: CockpitParams = {}) {
  const sp = new URLSearchParams();
  if (params.since) sp.set('since', params.since);
  if (params.until) sp.set('until', params.until);
  if (params.scope) sp.set('scope', params.scope);
  const qs = sp.toString();
  return api<CockpitResponse>(`/api/cockpit${qs ? `?${qs}` : ''}`);
}

// ============================================================================
// Lazy detail endpoints — fetched only when a drill-down is opened.
// ============================================================================

export interface CockpitDetailParams {
  since?: string;
  until?: string;
  practiceId?: string;
  limit?: number;
  offset?: number;
}

export interface CockpitLeadLine {
  id: string;
  contactId: string | null;
  createdAt: string;
  practiceName: string | null;
  channel: LeadChannel;
  pipelineName: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  converted: boolean;
  matchedValuePence: number;
  matchedTreatmentName: string | null;
  matchedPatientName: string | null;
  matchedAcceptedDate: string | null;
}

export interface CockpitLeadsDetail {
  window: { since: string | null; until: string | null };
  lines: CockpitLeadLine[];
  limit: number;
  offset: number;
}

export function fetchCockpitLeads(params: CockpitDetailParams = {}) {
  const sp = new URLSearchParams();
  if (params.since) sp.set('since', params.since);
  if (params.until) sp.set('until', params.until);
  if (params.practiceId) sp.set('practiceId', params.practiceId);
  sp.set('limit', String(params.limit ?? 500));
  if (params.offset) sp.set('offset', String(params.offset));
  return api<CockpitLeadsDetail>(`/api/cockpit/leads?${sp.toString()}`);
}

export interface CockpitTreatmentLine {
  id: string;
  acceptedDate: string;
  practiceName: string | null;
  patientName: string | null;
  treatmentName: string | null;
  valuePence: number;
  source: string | null;
  // The GHL ad pipeline this patient originally came in on (first touch), or
  // null if they never came through one (walk-in, referral, or unmatchable).
  leadChannel: LeadChannel | null;
  leadPipelineName: string | null;
  leadCreatedAt: string | null;
}

export interface CockpitTreatmentsDetail {
  window: { since: string | null; until: string | null };
  lines: CockpitTreatmentLine[];
  limit: number;
  offset: number;
}

export function fetchCockpitTreatments(params: CockpitDetailParams = {}) {
  const sp = new URLSearchParams();
  if (params.since) sp.set('since', params.since);
  if (params.until) sp.set('until', params.until);
  if (params.practiceId) sp.set('practiceId', params.practiceId);
  sp.set('limit', String(params.limit ?? 100));
  if (params.offset) sp.set('offset', String(params.offset));
  return api<CockpitTreatmentsDetail>(`/api/cockpit/treatments?${sp.toString()}`);
}

export interface CockpitRefund {
  [key: string]: unknown;
}

export interface CockpitCashupDayLine {
  cashupDate: string;
  practiceName: string | null;
  cashTakenPence: number;
  detailPence: number;
  variancePence: number;
  // Manager-keyed daily counts from the Emergent cash-up. Emergent sends a
  // count per day and no per-plan / per-lead records, so this day list is the
  // deepest these headline numbers can be drilled.
  txPlansGiven: number;
  txPlanValuePence: number;
  newLeads: number;
  attended: number;
  refunds: CockpitRefund[];
}

export interface CockpitCashupDaysDetail {
  window: { since: string | null; until: string | null };
  lines: CockpitCashupDayLine[];
}

export function fetchCockpitCashupDays(params: CockpitDetailParams = {}) {
  const sp = new URLSearchParams();
  if (params.since) sp.set('since', params.since);
  if (params.until) sp.set('until', params.until);
  if (params.practiceId) sp.set('practiceId', params.practiceId);
  sp.set('limit', String(params.limit ?? 100));
  if (params.offset) sp.set('offset', String(params.offset));
  return api<CockpitCashupDaysDetail>(`/api/cockpit/cashup-days?${sp.toString()}`);
}
