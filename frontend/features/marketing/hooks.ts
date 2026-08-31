// useScopePeriod returns { scope, win: { since, until, label } } — NOT a flat
// since/until. windowParams and scopeKey are the shared helpers every other
// analytics hook uses; going around them is how a screen ends up disagreeing
// with the rest of the dashboard about which window it is showing.
//
// ONE query key serves BOTH marketing screens. Overview and Campaigns ask for
// exactly the same payload, so React Query dedupes them into a single request
// and moving between the two tabs is instant rather than a second round trip.
// Do not give either screen its own key.
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useScopePeriod, windowParams, scopeKey } from '@/features/_shared/scope-context';
import { fetchMarketingPerformance, type MarketingPerformance } from './api';

export function useMarketingPerformance() {
  const { scope, win } = useScopePeriod();
  return useQuery<MarketingPerformance>({
    queryKey: ['marketing', 'performance', scopeKey({ scope, win })],
    queryFn: () => fetchMarketingPerformance(windowParams(scope, win)),
    // The server caches this payload for 10 minutes and the underlying data is
    // written by nightly syncs, so a five-minute client stale time costs
    // nothing in freshness and saves a refetch on every remount.
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    // Toggling practice or period keeps the previous figures on screen while
    // the next window loads, instead of blanking the page back to a skeleton
    // on every click.
    placeholderData: keepPreviousData,
    // Nothing here changes while the operator is reading it; refetching on tab
    // focus just re-runs the heaviest query on the dashboard for no new data.
    refetchOnWindowFocus: false,
  });
}
