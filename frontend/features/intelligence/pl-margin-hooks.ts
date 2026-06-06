'use client';

import { useQuery } from '@tanstack/react-query';
import { useScopePeriod, scopeKey } from '@/features/_shared/scope-context';
import { fetchPLMargin } from './pl-margin-api';

// P&L & Margin. Refetches on scope/period change (real monthly_financials actuals).
export function usePLMargin() {
  const sp = useScopePeriod();
  return useQuery({
    queryKey: ['pl-margin', scopeKey(sp)],
    queryFn: () => fetchPLMargin(sp.scope, sp.win),
    staleTime: 60_000,
  });
}
