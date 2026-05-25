// Business Hub API — the group + per-practice business rollup.
// GET /api/analytics/business-hub (finance.view gated). All *_pence are integer pence.

import { api } from '@/lib/api';
import { useQuery } from '@tanstack/react-query';

export interface HubPractice {
  practiceId: string;
  name: string;
  chairs: number;
  revenuePence: number;
  appointments: number;
  completed: number;
  noShows: number;
  noShowRate: number;     // percentage points
  leads: number;
  conversionRate: number; // percentage points
}

export interface BusinessHub {
  period: { days: number; since: string };
  group: {
    practices: number;
    revenuePence: number;
    revenueTargetPence: number;
    marginPct: number;
    appointments: number;
    noShows: number;
    noShowRate: number;
    leads: number;
    conversionRate: number;
  };
  practices: HubPractice[];
  truncated: boolean;
}

export function getBusinessHub(days = 90) {
  return api<BusinessHub>(`/api/analytics/business-hub?days=${days}`);
}

export function useBusinessHub(days = 90) {
  return useQuery({
    queryKey: ['business-hub', days],
    queryFn: () => getBusinessHub(days),
    staleTime: 30_000,
  });
}
