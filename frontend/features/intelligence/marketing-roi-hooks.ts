'use client';

import { useQuery } from '@tanstack/react-query';
import { useScopePeriod, type ResolvedWindow } from '@/features/_shared/scope-context';
import { fetchMarketingRoi } from './marketing-roi-api';

// Marketing & ROI. Refetches on scope/period/account-filter change (real
// ad_metrics + CRM leads). accountIds undefined/empty = all (honours the
// Integrations selection); a list narrows the view to those accounts.
// scopeOverride pins the scope (e.g. 'all') regardless of the global practice
// scope — ad spend isn't practice-attributed (ad_metrics.practice_id is null),
// so narrowing to a practice would wrongly empty the marketing view.
export function useMarketingRoi(accountIds?: string[], scopeOverride?: string) {
  const sp = useScopePeriod();
  const scope = scopeOverride ?? sp.scope;
  const acctKey = accountIds?.length ? accountIds.join(',') : 'all';
  return useQuery({
    queryKey: ['marketing-roi', { scope, since: sp.win.since, until: sp.win.until }, acctKey],
    queryFn: () => fetchMarketingRoi(scope, sp.win, accountIds),
    staleTime: 60_000,
  });
}

/**
 * The same feed over an EXPLICIT window — used for the Business Hub's
 * period-on-period comparison.
 *
 * Deliberately a second call to the same endpoint rather than a `compare_*`
 * parameter or a separate priors payload: the comparison figure cannot drift
 * from the figure it is measured against, because it IS that figure asked for
 * a different month. The window comes from the business-hub payload's own
 * `compare.previous`, so both sections of the page compare across identical
 * bounds — including the clamping that makes a running month read against the
 * same elapsed days of the month before.
 *
 * `win` is null until that payload arrives; the query stays disabled until then
 * rather than guessing a window.
 */
export function useMarketingRoiFor(win: ResolvedWindow | null, accountIds?: string[], scopeOverride?: string) {
  const sp = useScopePeriod();
  const scope = scopeOverride ?? sp.scope;
  const acctKey = accountIds?.length ? accountIds.join(',') : 'all';
  return useQuery({
    queryKey: ['marketing-roi', { scope, since: win?.since, until: win?.until }, acctKey],
    queryFn: () => fetchMarketingRoi(scope, win as ResolvedWindow, accountIds),
    enabled: !!win,
    staleTime: 60_000,
  });
}
