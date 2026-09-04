// This page sits under the shared scope bar, which has a period pill row
// (mode: 'month' | 'year' | 'custom', resolving to win.since/win.until) — a
// user changing period must move these numbers, or the pill is a control
// that appears to work and does nothing. So, unlike the read-only
// Reconciliation panel (Integrations page, no scope bar, sends no window at
// all), the window IS sent here, together with practice scope.
//
// The since/until -> plain-YYYY-MM-DD conversion (and why it is NOT the
// shared windowParams(scope, win) every other marketing hook uses) now lives
// in ../_shared/window.ts, shared verbatim with the Google report's
// hooks.ts — two independent copies of DST-sensitive date arithmetic is
// exactly the kind of thing that silently drifts between two pages that must
// agree. See that file's header for the full reasoning (BST midnight
// slicing, the spring-forward-Sunday 24h-subtraction bug, and the 92-day
// clamp echoed back as effectiveSince/windowClamped).
import { useQuery, useInfiniteQuery, keepPreviousData } from '@tanstack/react-query';
import { useScopePeriod, scopeKey } from '@/features/_shared/scope-context';
import { ymdWindowParams } from '../_shared/window';
import {
  fetchFacebookCampaigns, fetchFacebookAdSets, fetchFacebookAds,
  type FacebookCampaignsPayload, type FacebookAdSetsPayload, type FacebookAdsPage,
} from './api';

export function useFacebookCampaigns() {
  const { scope, win } = useScopePeriod();
  const qs = ymdWindowParams(scope, win);
  return useQuery<FacebookCampaignsPayload>({
    queryKey: ['marketing', 'facebook', 'campaigns', scopeKey({ scope, win })],
    queryFn: () => fetchFacebookCampaigns(qs),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
  });
}

// campaignId is OPTIONAL and, unlike the old nested-route version, this is
// now ALWAYS enabled — the Ad sets tab lists every ad set in the window when
// there is no campaign filter, which is the whole point of Task 2 moving the
// parent id off the path and into the query. Called unconditionally from the
// top-level FacebookReportScreen (not just from inside the Ad sets tab) so
// its result can double as the source for the Ads tab's filter-chip name
// lookup — same cache entry, no second request, same "reuse the call the
// app already made" idiom the old AdSetsScreen used for the campaign name.
export function useFacebookAdSets(campaignId: string | null) {
  const { scope, win } = useScopePeriod();
  const qs = ymdWindowParams(scope, win);
  const full = campaignId ? `${qs}&campaignId=${encodeURIComponent(campaignId)}` : qs;
  return useQuery<FacebookAdSetsPayload>({
    queryKey: ['marketing', 'facebook', 'adsets', campaignId ?? 'all', scopeKey({ scope, win })],
    queryFn: () => fetchFacebookAdSets(full),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
  });
}

// Ads for one ad set, or every ad in the window when adSetId is null (the Ads
// tab unfiltered), one page at a time — a tenant with many times this org's
// ad count must not be rendered in one response. useInfiniteQuery, not
// repeated useQuery calls with cursor in the key: the cursor is a page
// PARAMETER react-query threads through queryFn/getNextPageParam itself, not
// a cache-key dimension — putting it in the key would give every page its
// own cache entry instead of one growing list. Matches the shape of
// useTreatmentsCompletedLines (clinicians-hooks.ts).
//
// No `enabled` flag: this is now a real tab (FacebookAdsTab), not a
// lazily-expanded row — when it is mounted it is because the tab is active
// and its data is wanted, matching how the Campaigns/Ad sets tabs behave.
export function useFacebookAds(adSetId: string | null) {
  const { scope, win } = useScopePeriod();
  const qs = ymdWindowParams(scope, win);
  const base = adSetId ? `${qs}&adSetId=${encodeURIComponent(adSetId)}` : qs;
  return useInfiniteQuery<FacebookAdsPage>({
    queryKey: ['marketing', 'facebook', 'ads', adSetId ?? 'all', scopeKey({ scope, win })],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const cursor = pageParam as string | null;
      return fetchFacebookAds(cursor ? `${base}&cursor=${encodeURIComponent(cursor)}` : base);
    },
    // undefined (not null) tells react-query there is no next page — the
    // contract getNextPageParam must follow.
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
  });
}
