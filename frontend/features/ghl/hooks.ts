// frontend/features/ghl/hooks.ts
import { useQuery } from '@tanstack/react-query';
import { fetchGhlDashboard, type GhlDashboardParams } from './api';

// Consolidated GHL dashboard. Pass accountId to scope to one subaccount, and a
// since/until window (from the shared ScopePeriod state). Key includes all three
// so it refetches on filter/period change.
export function useGhlDashboard(params: GhlDashboardParams = {}) {
  return useQuery({
    queryKey: ['ghl-dashboard', params.accountId ?? 'all', params.since ?? '', params.until ?? ''],
    queryFn: () => fetchGhlDashboard(params),
    staleTime: 30_000,
  });
}
