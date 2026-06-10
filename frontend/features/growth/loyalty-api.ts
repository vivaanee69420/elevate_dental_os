import { api } from '@/lib/api';

// Loyalty & Membership — GET /api/growth/loyalty. Real, org-scoped membership
// data from membership_plans + memberships (manual/seeded; no external feed).
// Money fields are integer PENCE; counts are integers.

export interface LoyaltyTier {
  id: string;
  name: string;
  description: string | null;
  monthly_price_pence: number;
  benefits: string[];
  members: number;
  mrr_pence: number;
}

export interface LoyaltyReward {
  id: string;
  title: string;
  detail: string;
}

export interface LoyaltyCampaign {
  id: string;
  name: string;
  window: string;
  detail: string;
}

export interface Loyalty {
  active: number;
  total: number;
  mrr_pence: number;
  tiers: LoyaltyTier[];
  rewards: LoyaltyReward[];
  campaigns: LoyaltyCampaign[];
}

export function fetchLoyalty(): Promise<Loyalty> {
  return api<Loyalty>('/api/growth/loyalty');
}
