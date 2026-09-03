// This page sits under the shared scope bar, which has a period pill row
// (mode: 'month' | 'year' | 'custom', resolving to win.since/win.until) — a
// user changing period must move these numbers, or the pill is a control
// that appears to work and does nothing. So, unlike the read-only
// Reconciliation panel (Integrations page, no scope bar, sends no window at
// all), the window IS sent here, together with practice scope.
//
// It is NOT sent via the shared windowParams(scope, win) helper every other
// marketing hook uses, even though the brief for this task originally said
// to reuse it verbatim. windowParams emits since/until as full ISO datetimes
// on a HALF-OPEN [since, until) window — the shape /api/marketing/performance
// etc. take. The Facebook endpoints' FacebookQuerySchema
// (backend/src/controllers/marketing.controller.js) instead requires plain
// `YYYY-MM-DD` matching `/^\d{4}-\d{2}-\d{2}$/`, BOTH ends INCLUSIVE — the
// same convention the ads-deep-grain Reconciliation endpoint uses, because
// campaignSpendByProvider() compares them against a plain DATE column with
// `.gte(...).lte(...)`. Sending win.since/win.until as-is would 400 on every
// request (backend/test/marketing.routes.test.mjs asserts a non-YYYY-MM-DD
// string is rejected) — and even format aside, win.until directly would ask
// for one day too many, since it is the EXCLUSIVE start of the day *after*
// the period, not the last day in it.
//
// Converting the ISO instant to a calendar date with `.slice(0, 10)` is ALSO
// wrong: during BST, London midnight is 23:00 UTC the PREVIOUS day, so
// slicing win.since would silently return yesterday's date for roughly half
// the year. londonDateOf() below reads the calendar date via Intl against
// Europe/London instead — the same technique backend/src/lib/tz.js uses
// server-side — so this agrees with the server regardless of DST.
//
// The server does not stop at this window either: the deep-grain tables only
// hold a rolling 92 days, so a "year" request is clamped there
// (facebook-report.service.js's clampWindow) and the clamp is reported back
// as effectiveSince/windowClamped on every payload — that is what lets a
// future component say "showing from X" rather than quietly showing less
// than what the period pill claims.
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useScopePeriod, scopeKey, type ResolvedWindow } from '@/features/_shared/scope-context';
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

// en-CA renders as YYYY-MM-DD; explicit options match backend/src/lib/tz.js's
// own YMD formatter rather than relying on en-CA's default shape.
const LONDON_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
});

/** The London calendar date (YYYY-MM-DD) a UTC ISO instant falls in. */
function londonDateOf(iso: string): string {
  return LONDON_DATE.format(new Date(iso));
}

/**
 * Builds the query string every Facebook fetcher takes: plain YYYY-MM-DD
 * since/until (both inclusive) plus practice_id. See the file header for why
 * this cannot be the shared windowParams(scope, win).
 */
function facebookWindowParams(scope: string, win: ResolvedWindow): string {
  const sp = new URLSearchParams();
  sp.set('since', londonDateOf(win.since));
  // win.until is the exclusive start of the day AFTER the period — step back
  // 24h before reading the calendar date, to land on the last INCLUSIVE day.
  sp.set('until', londonDateOf(new Date(new Date(win.until).getTime() - 86_400_000).toISOString()));
  const practiceId = practiceOf(scope);
  if (practiceId) sp.set('practice_id', practiceId);
  return sp.toString();
}

export function useFacebookCampaigns() {
  const { scope, win } = useScopePeriod();
  const qs = facebookWindowParams(scope, win);
  return useQuery<FacebookCampaignsPayload>({
    queryKey: ['marketing', 'facebook', 'campaigns', scopeKey({ scope, win })],
    queryFn: () => fetchFacebookCampaigns(qs),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  });
}

export function useFacebookAdSets(campaignId: string) {
  const { scope, win } = useScopePeriod();
  const qs = facebookWindowParams(scope, win);
  return useQuery<FacebookAdSetsPayload>({
    queryKey: ['marketing', 'facebook', 'adsets', campaignId, scopeKey({ scope, win })],
    queryFn: () => fetchFacebookAdSets(campaignId, qs),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
    enabled: Boolean(campaignId),
  });
}

export function useFacebookAds(adSetId: string, enabled: boolean) {
  const { scope, win } = useScopePeriod();
  const qs = facebookWindowParams(scope, win);
  return useQuery<FacebookAdsPage>({
    queryKey: ['marketing', 'facebook', 'ads', adSetId, scopeKey({ scope, win })],
    queryFn: () => fetchFacebookAds(adSetId, qs),
    staleTime: 5 * 60_000,
    enabled: enabled && Boolean(adSetId),
  });
}
