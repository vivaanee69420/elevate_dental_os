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
import {
  fetchMarketingPerformance, fetchMarketingTrend, fetchMarketingLeads,
  type MarketingPerformance, type TrendMonth, type MarketingLeadPage,
} from './api';

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

// Channels over time asks for its OWN window — the last 12 complete months
// plus the current one — rather than the ScopePeriod month. A trend of one
// point is not a trend, and the scope bar's window is the wrong question here.
// The practice scope still applies, so the page follows the practice filter.
export function useMarketingTrend(months = 12) {
  const { scope } = useScopePeriod();
  const until = new Date();
  const since = new Date(until.getFullYear(), until.getMonth() - (months - 1), 1);
  const qs = new URLSearchParams({
    since: since.toISOString(),
    until: new Date(until.getFullYear(), until.getMonth() + 1, 1).toISOString(),
    scope: scope ?? 'all',
  }).toString();

  return useQuery<{ months: TrendMonth[] }>({
    queryKey: ['marketing', 'trend', scope ?? 'all', months, since.toISOString().slice(0, 7)],
    queryFn: () => fetchMarketingTrend(qs),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  });
}

// The leads list is paged and filtered SERVER-side, so a window holding
// thousands of people never ships thousands of names to the browser.
export function useMarketingLeads(opts: {
  page: number; size: number; channel: string | null; converted: 'true' | 'false' | 'any';
}) {
  const { scope, win } = useScopePeriod();
  const params = new URLSearchParams(windowParams(scope, win));
  params.set('page', String(opts.page));
  params.set('size', String(opts.size));
  if (opts.channel) params.set('channel', opts.channel);
  if (opts.converted !== 'any') params.set('converted', opts.converted);
  const qs = params.toString();

  return useQuery<MarketingLeadPage>({
    queryKey: ['marketing', 'leads', scopeKey({ scope, win }), opts.page, opts.size, opts.channel, opts.converted],
    queryFn: () => fetchMarketingLeads(qs),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  });
}
