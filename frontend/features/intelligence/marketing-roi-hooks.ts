'use client';

import { useQuery } from '@tanstack/react-query';
import { useScopePeriod } from '@/features/_shared/scope-context';
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
