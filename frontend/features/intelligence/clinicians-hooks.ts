'use client';

import { useQuery } from '@tanstack/react-query';
import { useScopePeriod, scopeKey } from '@/features/_shared/scope-context';
import { fetchClinicians } from './clinicians-api';

// Clinicians. Refetches on scope/period change (real roster + production + appts).
export function useClinicians() {
  const sp = useScopePeriod();
  return useQuery({
    queryKey: ['clinicians', scopeKey(sp)],
    queryFn: () => fetchClinicians(sp.scope, sp.win),
    staleTime: 60_000,
  });
}
