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
  leads: number;
  patients: number;
  unattributedLeads: number;
  costPerLeadPence: number | null;
  costPerPatientPence: number | null;
}

export interface MarketingPerformance { rows: CampaignRow[]; totals: MarketingTotals }

export const EMPTY_PERFORMANCE: MarketingPerformance = {
  rows: [],
  totals: {
    spendPence: 0, impressions: 0, clicks: 0, platformConversions: 0,
    leads: 0, patients: 0, unattributedLeads: 0,
    costPerLeadPence: null, costPerPatientPence: null,
  },
};

export async function fetchMarketingPerformance(qs: string): Promise<MarketingPerformance> {
  return api(`/api/marketing/performance?${qs}`);
}
