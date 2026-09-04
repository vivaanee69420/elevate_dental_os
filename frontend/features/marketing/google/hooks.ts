// This page sits under the shared scope bar, exactly like the Facebook
// report — a user changing period must move these numbers. The
// since/until -> plain-YYYY-MM-DD conversion lives in ../_shared/window.ts,
// shared verbatim with ../facebook/hooks.ts, so the two pages cannot
// silently disagree about what a given period's window actually is. See
// that file's header for the full DST reasoning.
import { useQuery, useInfiniteQuery, keepPreviousData } from '@tanstack/react-query';
import { useScopePeriod, scopeKey } from '@/features/_shared/scope-context';
import { ymdWindowParams } from '../_shared/window';
import {
  fetchGoogleCampaigns, fetchGoogleAdGroups, fetchGoogleAds, fetchGoogleKeywords,
  type GoogleCampaignsPayload, type GoogleAdGroupsPayload, type GoogleAdsPage, type GoogleKeywordsPage,
} from './api';

export function useGoogleCampaigns() {
  const { scope, win } = useScopePeriod();
  const qs = ymdWindowParams(scope, win);
  return useQuery<GoogleCampaignsPayload>({
    queryKey: ['marketing', 'google', 'campaigns', scopeKey({ scope, win })],
    queryFn: () => fetchGoogleCampaigns(qs),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
  });
}

// campaignId is OPTIONAL — this is always enabled, so the Ad groups tab can
// list every ad group in the window when there is no campaign filter.
// Called unconditionally from the top-level GoogleReportScreen (not just
// from inside the Ad groups tab) so its result can double as the source for
// the Ads/Keywords tabs' ad-group filter-chip name lookup — same cache
// entry, no second request, same "reuse the call the app already made"
// idiom ../facebook/hooks.ts's useFacebookAdSets uses.
export function useGoogleAdGroups(campaignId: string | null) {
  const { scope, win } = useScopePeriod();
  const qs = ymdWindowParams(scope, win);
  const full = campaignId ? `${qs}&campaignId=${encodeURIComponent(campaignId)}` : qs;
  return useQuery<GoogleAdGroupsPayload>({
    queryKey: ['marketing', 'google', 'adgroups', campaignId ?? 'all', scopeKey({ scope, win })],
    queryFn: () => fetchGoogleAdGroups(full),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
  });
}

// Ads for one ad group, or every ad in the window when parentId is null (the
// Ads tab unfiltered), one page at a time. useInfiniteQuery, not repeated
// useQuery calls with cursor in the key — same reasoning as
// useFacebookAds. No `enabled` flag: this is a real tab, mounted only when
// active and its data is wanted. No `orgState` prop either (unlike
// FacebookAdsTab borrowing the Campaigns tab's state) — ads() returns its
// OWN state, per google-report.service.js's file header.
export function useGoogleAds(parentId: string | null) {
  const { scope, win } = useScopePeriod();
  const qs = ymdWindowParams(scope, win);
  const base = parentId ? `${qs}&parentId=${encodeURIComponent(parentId)}` : qs;
  return useInfiniteQuery<GoogleAdsPage>({
    queryKey: ['marketing', 'google', 'ads', parentId ?? 'all', scopeKey({ scope, win })],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const cursor = pageParam as string | null;
      return fetchGoogleAds(cursor ? `${base}&cursor=${encodeURIComponent(cursor)}` : base);
    },
    // undefined (not null) tells react-query there is no next page — the
    // contract getNextPageParam must follow.
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
  });
}

// Keywords — the SIBLING of ads under the same ad group, so this takes the
// SAME parentId filter as useGoogleAds, not a nested one. Same paging idiom.
export function useGoogleKeywords(parentId: string | null) {
  const { scope, win } = useScopePeriod();
  const qs = ymdWindowParams(scope, win);
  const base = parentId ? `${qs}&parentId=${encodeURIComponent(parentId)}` : qs;
  return useInfiniteQuery<GoogleKeywordsPage>({
    queryKey: ['marketing', 'google', 'keywords', parentId ?? 'all', scopeKey({ scope, win })],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const cursor = pageParam as string | null;
      return fetchGoogleKeywords(cursor ? `${base}&cursor=${encodeURIComponent(cursor)}` : base);
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
  });
}
