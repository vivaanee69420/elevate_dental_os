// useScopePeriod returns { scope, win: { since, until, label } } — NOT a flat
// since/until. windowParams and scopeKey are the shared helpers every other
// analytics hook uses; going around them is how a screen ends up disagreeing
// with the rest of the dashboard about which window it is showing.
import { useQuery } from '@tanstack/react-query';
import { useScopePeriod, windowParams, scopeKey } from '@/features/_shared/scope-context';
import { fetchMarketingPerformance, type MarketingPerformance } from './api';

export function useMarketingPerformance() {
  const { scope, win } = useScopePeriod();
  return useQuery<MarketingPerformance>({
    queryKey: ['marketing', 'performance', scopeKey({ scope, win })],
    queryFn: () => fetchMarketingPerformance(windowParams(scope, win)),
    staleTime: 60_000,
  });
}
