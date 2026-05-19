import { useQuery } from '@tanstack/react-query';
import {
  getDashboardSummary,
  getRevenueSeries,
  getPracticeSummary,
} from './api';

export function useDashboardSummary() {
  return useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: getDashboardSummary,
  });
}

export function useRevenueSeries() {
  return useQuery({ queryKey: ['revenue-series'], queryFn: getRevenueSeries });
}

export function usePracticeSummary() {
  return useQuery({
    queryKey: ['practice-summary'],
    queryFn: getPracticeSummary,
  });
}
