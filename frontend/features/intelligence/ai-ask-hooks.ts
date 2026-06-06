'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useScopePeriod, scopeKey } from '@/features/_shared/scope-context';
import { postAiAsk } from './ai-ask-api';

// Prioritised findings for the current scope/period (no question → no model call).
export function useAiFindings() {
  const sp = useScopePeriod();
  return useQuery({
    queryKey: ['ai-findings', scopeKey(sp)],
    queryFn: () => postAiAsk(sp.scope, sp.period, sp.periodKey),
    staleTime: 60_000,
  });
}

// Ask box — POSTs the question against the live scope/period data.
export function useAiAsk() {
  const sp = useScopePeriod();
  return useMutation({
    mutationFn: (question: string) => postAiAsk(sp.scope, sp.period, sp.periodKey, question),
  });
}
