'use client';

import { useQuery } from '@tanstack/react-query';
import { useScopePeriod, scopeKey } from '@/features/_shared/scope-context';
import { fetchLeakage, type LeakageRates } from './leakage-api';

// Revenue Leakage. Refetches on scope/period change and whenever the tuned
// recoverable rates change (debounced by the caller). Rates are sent through
// to the API so the annualised pools reflect the user's reality.
export function useLeakage(rates?: Partial<LeakageRates>) {
  const sp = useScopePeriod();
  const rateKey = rates ? JSON.stringify(rates) : 'default';
  return useQuery({
    queryKey: ['leakage', scopeKey(sp), rateKey],
    queryFn: () => fetchLeakage(sp.scope, sp.win, rates),
    staleTime: 60_000,
  });
}
