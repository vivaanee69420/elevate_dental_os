'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchDataQuality } from './data-quality-api';

// Data Quality Engine. Read-only org-wide health; no scope/period inputs.
export function useDataQuality() {
  return useQuery({
    queryKey: ['data-quality'],
    queryFn: fetchDataQuality,
    staleTime: 60_000,
  });
}
