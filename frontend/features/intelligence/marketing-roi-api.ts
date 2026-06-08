import { api } from '@/lib/api';
import { windowParams, type ResolvedWindow } from '@/features/_shared/scope-context';

// Marketing & ROI (GM Intelligence OS) — GET /api/analytics/marketing-roi.
// Per-channel acquisition economics from REAL ad_metrics (spend) + CRM leads
// (attribution + conversion). Money in PENCE.
//
// HONEST DATA WALL: spend + leads are real per channel; REVENUE IS NOT
// attributable per channel — only a business-level blended paid ROAS. No
// per-channel revenue/ROAS field exists. Conversions = leads reaching
// treatment_started/treatment_completed (one consistent definition).

export interface MktChannel {
  key: string;
  label: string;
  color: string;
  paid: boolean;
  group: 'paid' | 'organic';
  spendPence: number;
  impressions: number;
  clicks: number;
  leads: number;
  conversions: number;
  cplPence: number;
  cpaPence: number;
  leadSharePct: number;
  convRatePct: number;
}

export interface MktAccount {
  provider: string;
  customerId: string | null;
  name: string | null;
  currency: string | null;
  status: string | null;
  spendPence: number;
  impressions: number;
  clicks: number;
  reach: number;
  conversions: number;
  cpaPence: number;
  cpcPence: number;
}

export interface MktPractice {
  id: string;
  name: string;
  leads: number;
  conversions: number;
  convRatePct: number;
  revenuePence: number;
  spendPence: number;
  cpaPence: number;
  roas: number | null;
}

export interface MktInsight {
  tone: 'good' | 'warn' | 'bad' | 'info';
  title: string;
  body: string;
  value?: string;
}

export interface MarketingRoi {
  applicable: boolean;
  scope: string;
  period: 'month' | 'day';
  window?: { since: string; until: string; label: string };
  connected: boolean;
  hasLeads: boolean;
  channels: MktChannel[];
  paidSpendPence: number;
  totalLeads: number;
  totalConversions: number;
  settledRevenuePence: number;
  blendedRoas: number | null;
  blendedRoiPct: number | null;
  google: MktChannel | null;
  meta: MktChannel | null;
  accountFilter: string[] | null; // null = all; [] = none
  byAccount: MktAccount[];
  revenuePerChannelAvailable: boolean;
  byPracticeAvailable: boolean;
  adSpendPerPracticeAvailable: boolean;
  byPractice: MktPractice[];
  insights: MktInsight[];
  note?: string;
}

const EMPTY: MarketingRoi = {
  applicable: true, scope: 'all', period: 'month', connected: false, hasLeads: false,
  channels: [], paidSpendPence: 0, totalLeads: 0, totalConversions: 0, settledRevenuePence: 0,
  blendedRoas: null, blendedRoiPct: null, google: null, meta: null,
  accountFilter: null, byAccount: [],
  revenuePerChannelAvailable: false, byPracticeAvailable: false, adSpendPerPracticeAvailable: false,
  byPractice: [], insights: [],
};

export function fetchMarketingRoi(scope: string, win: ResolvedWindow, accountIds?: string[]): Promise<MarketingRoi> {
  const acct = accountIds?.length ? `&account_ids=${encodeURIComponent(accountIds.join(','))}` : '';
  return api<MarketingRoi>(`/api/analytics/marketing-roi?${windowParams(scope, win)}${acct}`).then((r) => ({ ...EMPTY, ...r }));
}
