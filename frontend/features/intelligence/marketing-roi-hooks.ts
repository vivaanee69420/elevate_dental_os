'use client';

import { useQuery } from '@tanstack/react-query';
import { useScopePeriod, scopeKey } from '@/features/_shared/scope-context';
import { fetchMarketingRoi } from './marketing-roi-api';

// Marketing & ROI. Refetches on scope/period change (real ad_metrics + CRM leads).
export function useMarketingRoi() {
  const sp = useScopePeriod();
  return useQuery({
    queryKey: ['marketing-roi', scopeKey(sp)],
    queryFn: () => fetchMarketingRoi(sp.scope, sp.win),
    staleTime: 60_000,
  });
}
