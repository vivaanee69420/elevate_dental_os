'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { computeAcquisition, type AcquisitionInput, type AcquisitionResult } from './acquisition-api';

// Debounce slider drags — one request per settle, not per tick.
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

// Server-authoritative acquisition recompute (Arch #3). `placeholderData: prev`
// keeps the last result visible while a new compute is in flight.
export function useAcquisition(input: AcquisitionInput) {
  const debounced = useDebounced(input, 250);
  return useQuery<AcquisitionResult>({
    queryKey: ['acquisition-compute', debounced],
    queryFn: () => computeAcquisition(debounced),
    placeholderData: (prev) => prev,
  });
}
