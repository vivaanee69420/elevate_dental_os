'use client';

import { useQuery } from '@tanstack/react-query';
import { useScopePeriod, scopeKey } from '@/features/_shared/scope-context';
import { fetchCashByDay } from './cash-by-day-api';

// Day — Cash Collected. Refetches on scope/period change (real settled receipts).
export function useCashByDay() {
  const sp = useScopePeriod();
  return useQuery({
    queryKey: ['cash-by-day', scopeKey(sp)],
    queryFn: () => fetchCashByDay(sp.scope, sp.win),
    staleTime: 60_000,
  });
}
