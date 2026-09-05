// This page sits under the shared scope bar, exactly like the Facebook
// report — a user changing period must move these numbers. The
// since/until -> plain-YYYY-MM-DD conversion lives in ../_shared/window.ts,
// shared verbatim with ../facebook/hooks.ts, so the two pages cannot
// silently disagree about what a given period's window actually is. See
// that file's header for the full DST reasoning.
import { useQuery, useInfiniteQuery, keepPreviousData } from '@tanstack/react-query';
import { useScopePeriod, scopeKey } from '@/features/_shared/scope-context';
import {
  ymdWindowParams, ymdWindowParamsFor, londonDateOf, lastInclusiveLondonDay,
} from '../_shared/window';
import {
  fetchGoogleCampaigns, fetchGoogleAdGroups, fetchGoogleAds, fetchGoogleKeywords,
  fetchGoogleSearchTerms, fetchGoogleLeadPerformance,
  type GoogleCampaignsPayload, type GoogleAdGroupsPayload, type GoogleAdsPage, type GoogleKeywordsPage,
  type GoogleSearchTermsPage, type GoogleLeadPerformancePayload,
} from './api';

// The blended CPL/CPB/CPA cards. Same scope-bar plumbing as every other hook
// here — ymdWindowParams already sends `practice_id` only when the bar is
// narrowed to one practice, so "All practices" (the bar's own default) is
// what this renders with no extra code on this page's side.
// The owner-requested "include existing patients" toggle is answered
// entirely client-side (GoogleLeadPerformanceCards reads practicesAll/
// totalAll instead of practices/total) — this hook fetches ONCE per
// org+window and both figures come out of that same response, so flipping
// the toggle costs no extra request. It used to take an `includeExisting`
// argument and re-fetch with `?include_existing=1`; that was the single
// biggest speed problem on this page, since the SQL itself never depended
// on the flag, only on how the already-fetched rows get summed.
export function useGoogleLeadPerformance() {
  const { scope, win } = useScopePeriod();
  const qs = ymdWindowParams(scope, win);
  return useQuery<GoogleLeadPerformancePayload>({
    queryKey: ['marketing', 'google', 'lead-performance', scopeKey({ scope, win })],
    queryFn: () => fetchGoogleLeadPerformance(qs),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
  });
}

/**
 * The selected period as the plain inclusive YYYY-MM-DD pair the cards'
 * comparison arithmetic works in.
 *
 * Read through the SAME londonDateOf/lastInclusiveLondonDay pair that builds
 * the request, not re-derived from win.since/win.until here. Those two
 * conversions are where this codebase has twice put a DST bug (see
 * ../_shared/window.ts's header); computing the displayed period one way and
 * the requested period another is how the comparison would end up measured
 * against a window a day away from the one on screen.
 */
export function useSelectedYmdWindow(): { since: string; until: string } {
    const { win } = useScopePeriod();
    return { since: londonDateOf(win.since), until: lastInclusiveLondonDay(win.until) };
}

/**
 * The same cards, for an ARBITRARY window — the comparison period.
 *
 * A second call to the same endpoint rather than a `compare_since`/
 * `compare_until` parameter on the first: the two periods are then computed
 * by one code path on the server, cached independently (the service already
 * keys its 60s cache on org+window), and a comparison window that happens to
 * equal a window already on screen costs nothing. It also means the
 * comparison cannot drift from the primary figure, because it IS the primary
 * figure, asked for a different fortnight.
 *
 * `enabled` is false while comparison is off, so the page fires no request at
 * all until the user asks for one.
 */
export function useGoogleLeadPerformanceFor(
    compareWindow: { since: string; until: string } | null,
) {
    const { scope } = useScopePeriod();
    const qs = compareWindow ? ymdWindowParamsFor(scope, compareWindow.since, compareWindow.until) : '';
    return useQuery<GoogleLeadPerformancePayload>({
        queryKey: ['marketing', 'google', 'lead-performance', 'compare',
            scope, compareWindow?.since ?? '', compareWindow?.until ?? ''],
        queryFn: () => fetchGoogleLeadPerformance(qs),
        enabled: Boolean(compareWindow),
        placeholderData: keepPreviousData,
        staleTime: 5 * 60_000,
        gcTime: 30 * 60_000,
        refetchOnWindowFocus: false,
    });
}

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
// active and its data is wanted. No `orgState` prop either — ads() returns
// its OWN state, per google-report.service.js's file header (matching
// facebook-report.service.js's ads(), which does the same for its grain).
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

// Search terms — what people actually typed. Same parentId filter and same
// paging idiom as ads/keywords; the 30-day window is applied and REPORTED by
// the server (windowDays on the payload), not assumed here, so this tab can
// never claim a period the sync does not pull.
export function useGoogleSearchTerms(parentId: string | null) {
  const { scope, win } = useScopePeriod();
  const qs = ymdWindowParams(scope, win);
  const base = parentId ? `${qs}&parentId=${encodeURIComponent(parentId)}` : qs;
  return useInfiniteQuery<GoogleSearchTermsPage>({
    queryKey: ['marketing', 'google', 'search-terms', parentId ?? 'all', scopeKey({ scope, win })],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const cursor = pageParam as string | null;
      return fetchGoogleSearchTerms(cursor ? `${base}&cursor=${encodeURIComponent(cursor)}` : base);
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
  });
}
