// frontend/features/cockpit/hooks.ts
import { useQuery } from '@tanstack/react-query';
import { fetchCockpit, type CockpitParams } from './api';

// Daily Command Cockpit. Key includes since/until (from the shared
// ScopePeriod window) so it refetches when the window changes.
export function useCockpit(params: CockpitParams = {}) {
  return useQuery({
    queryKey: ['cockpit', params.since ?? '', params.until ?? ''],
    queryFn: () => fetchCockpit(params),
    staleTime: 30_000,
  });
}
