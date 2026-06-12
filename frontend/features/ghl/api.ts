// frontend/features/ghl/api.ts
// GHL consolidated dashboard — live aggregate across all subaccounts (or one).
import { api } from '@/lib/api';

export interface CountEntry { source?: string; stage?: string; count: number }

export interface GhlTotals {
  contacts: { total: number; new: number; bySource: CountEntry[] };
  leads: {
    total: number; new: number; open: number; won: number; lost: number;
    pipelineValuePence: number; conversionPct: number; byStage: CountEntry[];
  };
  conversations: { total: number; inbound: number; outbound: number; last7d: number };
  sync: { accounts: number; active: number; failed: number; lastSyncAt: string | null };
}

export interface GhlPerAccount {
  accountId: string | null;
  label: string;
  practiceId: string | null;
  status: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  contacts: number;
  leads: number;
  pipelineValuePence: number;
  conversionPct: number;
  conversations: number;
}

export interface GhlDashboardResponse {
  period: { since: string; until: string };
  totals: GhlTotals;
  perAccount: GhlPerAccount[];
}

export interface GhlDashboardParams {
  accountId?: string | null;
  since?: string;
  until?: string;
}

export function fetchGhlDashboard(params: GhlDashboardParams = {}) {
  const sp = new URLSearchParams();
  if (params.accountId) sp.set('accountId', params.accountId);
  if (params.since) sp.set('since', params.since);
  if (params.until) sp.set('until', params.until);
  const qs = sp.toString();
  return api<GhlDashboardResponse>(`/api/integrations/gohighlevel/dashboard${qs ? `?${qs}` : ''}`);
}
