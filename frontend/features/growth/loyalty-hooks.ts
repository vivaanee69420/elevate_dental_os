'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchLoyalty } from './loyalty-api';

// Loyalty & membership summary — active members, MRR, and per-tier breakdown
// for the current org. Read-only; no period input.
export function useLoyalty() {
  return useQuery({
    queryKey: ['loyalty'],
    queryFn: fetchLoyalty,
    staleTime: 60_000,
  });
}
