import { useQuery } from '@tanstack/react-query';
import { getRevenueSeries, getAiInsights } from './api';

export function useRevenueSeries() {
  return useQuery({
    queryKey: ['overview-revenue-series'],
    queryFn: getRevenueSeries,
  });
}

export function useAiInsights() {
  return useQuery({ queryKey: ['ai-insights'], queryFn: getAiInsights });
}
