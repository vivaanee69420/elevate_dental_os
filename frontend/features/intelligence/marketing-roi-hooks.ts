'use client';

import { useQuery } from '@tanstack/react-query';
import { useScopePeriod, scopeKey } from '@/features/_shared/scope-context';
import { fetchMarketingRoi } from './marketing-roi-api';

// Marketing & ROI. Refetches on scope/period/account-filter change (real
// ad_metrics + CRM leads). accountIds undefined/empty = all (honours the
// Integrations selection); a list narrows the view to those accounts.
export function useMarketingRoi(accountIds?: string[]) {
  const sp = useScopePeriod();
  const acctKey = accountIds?.length ? accountIds.join(',') : 'all';
  return useQuery({
    queryKey: ['marketing-roi', scopeKey(sp), acctKey],
    queryFn: () => fetchMarketingRoi(sp.scope, sp.win, accountIds),
    staleTime: 60_000,
  });
}
