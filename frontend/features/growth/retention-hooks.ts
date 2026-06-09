'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchRetention } from './retention-api';

// Attrition & Retention. Read-only patient cohorts + reactivation pool for the
// given scope (default whole group). No period input — cohorts are last-visit
// relative to now.
export function useRetention(scope = 'all') {
  return useQuery({
    queryKey: ['retention', scope],
    queryFn: () => fetchRetention(scope),
    staleTime: 60_000,
  });
}
