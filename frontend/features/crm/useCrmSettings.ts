'use client';
// CRM settings hook — reads the REAL per-org config + aggregator counts from
// /api/crm/settings. Replaces the static constants the Settings screen used to
// derive from ./data.
import { useQuery } from '@tanstack/react-query';
import { getCrmSettings, type CrmSettingsResponse } from './api/settings';

export function useCrmSettings() {
  return useQuery<CrmSettingsResponse>({
    queryKey: ['crm-settings'],
    queryFn: () => getCrmSettings(),
    staleTime: 60_000,
  });
}
