import { useQuery } from '@tanstack/react-query';
import {
  getDashboardSummary,
  getRevenueSeries,
} from './api';

export interface PeriodRange { from: string | null; to: string | null }

export function useDashboardSummary(range?: PeriodRange, practiceId: string | null = null) {
  return useQuery({
    queryKey: ['dashboard-summary', range?.from ?? null, range?.to ?? null, practiceId],
    queryFn: () => getDashboardSummary(range, practiceId),
  });
}

export function useRevenueSeries(range?: PeriodRange, practiceId: string | null = null) {
  return useQuery({
    queryKey: ['revenue-series', range?.from ?? null, range?.to ?? null, practiceId],
    queryFn: () => getRevenueSeries(range, practiceId),
  });
}
