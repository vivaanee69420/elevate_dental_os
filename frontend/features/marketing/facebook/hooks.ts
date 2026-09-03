// The window is NOT sent: the server defaults it from the same helpers the
// sync uses, so the two can never disagree about which days are in range.
// Practice scope IS sent, from the shared scope bar. `win` still goes into
// the query key (via scopeKey) purely so this hook agrees with every other
// analytics hook on ONE cache-key convention — it costs nothing since a
// period change is rare next to a practice change.
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useScopePeriod, scopeKey } from '@/features/_shared/scope-context';
import {
  fetchFacebookCampaigns, fetchFacebookAdSets, fetchFacebookAds,
  type FacebookCampaignsPayload, type FacebookAdSetsPayload, type FacebookAdsPage,
} from './api';

// Scope is a bare string: 'all' or a practiceId. Not an object — reading
// `scope.practiceId` would be undefined for every tenant and every request
// would silently go org-wide while the practice pills appeared to work.
// (frontend/features/_shared/scope-context.tsx: `export type Scope = string`.)
function practiceOf(scope: string | null | undefined): string | null {
  return scope && scope !== 'all' ? scope : null;
}

export function useFacebookCampaigns() {
  const { scope, win } = useScopePeriod();
  const practiceId = practiceOf(scope);
  return useQuery<FacebookCampaignsPayload>({
    queryKey: ['marketing', 'facebook', 'campaigns', scopeKey({ scope, win })],
    queryFn: () => fetchFacebookCampaigns(practiceId),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  });
}

export function useFacebookAdSets(campaignId: string) {
  const { scope, win } = useScopePeriod();
  const practiceId = practiceOf(scope);
  return useQuery<FacebookAdSetsPayload>({
    queryKey: ['marketing', 'facebook', 'adsets', campaignId, scopeKey({ scope, win })],
    queryFn: () => fetchFacebookAdSets(campaignId, practiceId),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
    enabled: Boolean(campaignId),
  });
}

export function useFacebookAds(adSetId: string, enabled: boolean) {
  const { scope, win } = useScopePeriod();
  const practiceId = practiceOf(scope);
  return useQuery<FacebookAdsPage>({
    queryKey: ['marketing', 'facebook', 'ads', adSetId, scopeKey({ scope, win })],
    queryFn: () => fetchFacebookAds(adSetId, null, practiceId),
    staleTime: 5 * 60_000,
    enabled: enabled && Boolean(adSetId),
  });
}
