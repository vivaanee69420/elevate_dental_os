'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useScopePeriod, scopeKey } from '@/features/_shared/scope-context';
import { fetchDecisionLens, type LensSurface, type DecisionLensResp } from './decision-lens-api';

// Decision Lens for the active scope/period. Cached 6h server-side; the client
// keeps it fresh for the same window and only refetches when scope/window
// changes. refresh() forces a server rebuild (refresh=1) and updates the cache.
export function useDecisionLens(surface: LensSurface) {
  const sp = useScopePeriod();
  const qc = useQueryClient();
  const key = ['decision-lens', surface, scopeKey(sp)] as const;
  const q = useQuery({
    queryKey: key,
    queryFn: () => fetchDecisionLens(surface, sp.scope, sp.win),
    staleTime: 6 * 3600_000,
    refetchOnWindowFocus: false,
  });
  const refresh = async () => {
    const fresh = await fetchDecisionLens(surface, sp.scope, sp.win, true);
    qc.setQueryData<DecisionLensResp>(key, fresh);
  };
  return { ...q, refresh };
}
