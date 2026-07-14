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

export interface LeadRoiChannelRow {
  practiceId: string | null;
  practiceName: string | null;
  channel: 'google' | 'facebook';
  leads: number;
  conversions: number;
  matchedValuePence: number;
}

export interface LeadRoiGroupStats {
  leads: number;
  conversions: number;
  matchedValuePence: number;
  spendPence: number;
}

export interface LeadRoi {
  channels: LeadRoiChannelRow[];
  group: {
    google: LeadRoiGroupStats;
    facebook: LeadRoiGroupStats;
  };
  spendByChannel: {
    google: number;
    facebook: number;
  };
}

export interface CockpitResponse {
  window: { since: string | null; until: string | null };
  revenue: {
    collectedPence: number;
    byPractice: CockpitPracticeRevenue[];
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
    byBusiness: CockpitBusinessMonthly[];
  };
  updatedAt: string;
}

export interface CockpitParams {
  since?: string;
  until?: string;
}

export function fetchCockpit(params: CockpitParams = {}) {
  const sp = new URLSearchParams();
  if (params.since) sp.set('since', params.since);
  if (params.until) sp.set('until', params.until);
  const qs = sp.toString();
  return api<CockpitResponse>(`/api/cockpit${qs ? `?${qs}` : ''}`);
}
