// Marketing API client. NOTE the /api prefix: the Next proxy forwards the path
// verbatim, so omitting it 404s SILENTLY into an empty state.
import { api } from '@/lib/api';

export type Tier = 'campaign' | 'channel' | 'unattributed';

export interface CampaignRow {
  provider: 'google_ads' | 'meta_ads';
  campaignId: string;
  campaignName: string | null;
  spendPence: number;
  impressions: number;
  clicks: number;
  platformConversions: number;
  leads: number;
  patients: number;
  costPerLeadPence: number | null;
  costPerPatientPence: number | null;
  tier: Tier;
}

export interface MarketingTotals {
  spendPence: number;
  impressions: number;
  clicks: number;
  platformConversions: number;
  /** Everyone who enquired in the window — organic and unattributed included. */
  leads: number;
  /** Only the people matched to a campaign with spend: the cost denominators. */
  attributedLeads: number;
  patients: number;
  unattributedLeads: number;
  costPerLeadPence: number | null;
  costPerPatientPence: number | null;
}

/** One channel's roll-up of the campaign rows. Sums to `totals`. */
export interface ChannelRow {
  provider: 'google_ads' | 'meta_ads';
  spendPence: number;
  impressions: number;
  clicks: number;
  platformConversions: number;
  leads: number;
  patients: number;
  campaigns: number;
  costPerLeadPence: number | null;
  costPerPatientPence: number | null;
}

/** One London calendar day of spend, split by channel. */
export interface SpendDay {
  date: string;
  spendPence: number;
  google_ads: number;
  meta_ads: number;
}

/**
 * Why a figure may be missing. Without this the screen cannot tell "this
 * practice spent nothing" apart from "no ad account is mapped to it, so none
 * of the group's spend can be attributed here" — both render as £0.00.
 */
export interface MarketingCoverage {
  totalAccounts: number;
  mappedAccounts: number;
  unmappedAccounts: number;
  unmappedAccountNames: string[];
  /** Spend on accounts with no practice mapping. Group view only. */
  unmappedSpendPence: number;
  /** null when not scoped to a practice. */
  practiceHasMappedAccount: boolean | null;
}

export interface MarketingPerformance {
  rows: CampaignRow[];
  totals: MarketingTotals;
  byChannel: ChannelRow[];
  series: SpendDay[];
  coverage: MarketingCoverage;
}

export const EMPTY_PERFORMANCE: MarketingPerformance = {
  rows: [],
  totals: {
    spendPence: 0, impressions: 0, clicks: 0, platformConversions: 0,
    leads: 0, attributedLeads: 0, patients: 0, unattributedLeads: 0,
    costPerLeadPence: null, costPerPatientPence: null,
  },
  byChannel: [],
  series: [],
  coverage: {
    totalAccounts: 0, mappedAccounts: 0, unmappedAccounts: 0,
    unmappedAccountNames: [], unmappedSpendPence: 0, practiceHasMappedAccount: null,
  },
};

export const CHANNEL_LABEL: Record<string, string> = {
  google_ads: 'Google',
  meta_ads: 'Facebook',
};

/**
 * Channel identity, fixed. Teal = Google, blue = Facebook, on every screen —
 * colour follows the entity, never its rank, so a filter that drops one
 * channel never repaints the other. Validated for colour-vision deficiency
 * against a white chart surface (deutan dE 22.2, tritan 11.2, normal 25.0).
 */
export const CHANNEL_COLOUR: Record<string, string> = {
  google_ads: '#0d9488',
  meta_ads: '#1d4ed8',
};

export async function fetchMarketingPerformance(qs: string): Promise<MarketingPerformance> {
  return api(`/api/marketing/performance?${qs}`);
}
