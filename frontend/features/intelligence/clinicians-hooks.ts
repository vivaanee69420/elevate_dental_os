'use client';

import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { useScopePeriod, scopeKey } from '@/features/_shared/scope-context';
import { fetchClinicians, fetchTreatmentsCompletedLines } from './clinicians-api';

const COMPLETED_PER_PAGE = 100;

// Clinicians. Refetches on scope/period change (real roster + production + appts).
export function useClinicians() {
  const sp = useScopePeriod();
  return useQuery({
    queryKey: ['clinicians', scopeKey(sp)],
    queryFn: () => fetchClinicians(sp.scope, sp.win),
    staleTime: 60_000,
  });
}

// Completed-treatment detail (patient · clinician · treatment · revenue) behind
// the Treatments Completed card. Paginated: `enabled` gates the fetch (so nothing
// loads until the panel is opened); the first page (100) lands fast and the
// caller back-fills the rest via fetchNextPage. `totals` is on page 0.
export function useTreatmentsCompletedLines(enabled: boolean) {
  const sp = useScopePeriod();
  return useInfiniteQuery({
    queryKey: ['treatments-completed-lines', scopeKey(sp)],
    enabled,
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      fetchTreatmentsCompletedLines(sp.scope, sp.win, { limit: COMPLETED_PER_PAGE, offset: pageParam as number }),
    getNextPageParam: (_lastPage, allPages) => {
      const loaded = allPages.reduce((s, p) => s + p.lines.length, 0);
      const total = allPages[0]?.totals?.count ?? 0;
      return loaded < total ? loaded : undefined;
    },
    staleTime: 60_000,
  });
}
