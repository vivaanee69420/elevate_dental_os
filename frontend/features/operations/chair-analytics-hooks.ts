'use client';

import { useQuery } from '@tanstack/react-query';
import { useScopePeriod, scopeKey } from '@/features/_shared/scope-context';
import { fetchChairAnalytics } from './chair-analytics-api';

// Refetches whenever scope or the recovery uplift changes (server-authoritative
// recovery per Arch #3 — the slider drives ?recover=).
export function useChairAnalytics(recover: number) {
  const sp = useScopePeriod();
  return useQuery({
    queryKey: ['chair-analytics', scopeKey(sp), recover],
    queryFn: () => fetchChairAnalytics(sp.scope, recover, sp.win),
  });
}
