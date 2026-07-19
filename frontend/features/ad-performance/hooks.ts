import { useQuery } from '@tanstack/react-query';
import { fetchAdPerformance, fetchAdLeads, type AdPerfParams, type PerfChannel } from './api';

// Key includes the window and practice so it refetches when the shared
// ScopePeriod bar changes. The 'ad-performance' prefix is what the settings
// mutations invalidate (see ../ad-attribution/hooks.ts), so a remap is
// reflected here immediately — do not change this prefix or a string-concat
// the key.
export function useAdPerformance(p: AdPerfParams) {
  return useQuery({
    queryKey: ['ad-performance', p.since, p.until, p.practiceId ?? ''],
    queryFn: () => fetchAdPerformance(p),
    staleTime: 30_000,
  });
}

// The key must start with 'ad-performance' (element zero) because settings mutations
// invalidate by that prefix — any other structure will be missed. `limit` is
// appended at the end (never element zero) so it can vary without breaking that
// invalidation.
export function useAdLeads(open: boolean, p: AdPerfParams & { channel?: PerfChannel; limit?: number }) {
  return useQuery({
    queryKey: ['ad-performance', 'leads', p.since, p.until, p.practiceId ?? '', p.channel ?? '', p.limit ?? ''],
    queryFn: () => fetchAdLeads(p),
    enabled: open,
    staleTime: 30_000,
  });
}
