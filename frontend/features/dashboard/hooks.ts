import { useQuery } from '@tanstack/react-query';
import {
  getDashboardSummary,
  getRevenueSeries,
  getPracticeSummary,
} from './api';

export interface PeriodRange { from: string | null; to: string | null }

export function useDashboardSummary(range?: PeriodRange) {
  return useQuery({
    queryKey: ['dashboard-summary', range?.from ?? null, range?.to ?? null],
    queryFn: () => getDashboardSummary(range),
  });
}

export function useRevenueSeries(range?: PeriodRange) {
  return useQuery({
    queryKey: ['revenue-series', range?.from ?? null, range?.to ?? null],
    queryFn: () => getRevenueSeries(range),
  });
}

export function usePracticeSummary() {
  return useQuery({
    queryKey: ['practice-summary'],
    queryFn: getPracticeSummary,
  });
}
