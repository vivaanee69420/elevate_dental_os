'use client';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface Subaccount {
  id: string;
  name: string;
  created_at: string;
  integrations: { provider: string; status: string }[];
  features: Record<string, boolean>;
}

// NB: `api()` posts to the same-origin proxy, which forwards the path VERBATIM
// to the backend — so every path here carries the `/api` prefix the Express
// routers are mounted under. Dropping it 404s silently.
export function useSubaccounts(enabled: boolean) {
  return useQuery<{ subaccounts: Subaccount[] }>({
    queryKey: ['agency', 'subaccounts'],
    queryFn: () => api('/api/agency/subaccounts'),
    enabled,
    staleTime: 60_000,
  });
}

/** Switch into a sub-account. Hard navigation on success: resets React Query
 *  caches + any per-org module state in one stroke. */
export async function switchInto(orgId: string) {
  const res = await fetch('/api/agency-switch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orgId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'Switch failed' }));
    throw new Error(body.error || 'Switch failed');
  }
  window.location.assign('/business-hub');
}

export async function exitSwitch() {
  await fetch('/api/agency-switch', { method: 'DELETE' });
  window.location.assign('/business-hub');
}

export async function createSubaccount(body: {
  organisation_name: string;
  owner_email: string;
  owner_name: string;
}) {
  return api<{ organisation_id: string; owner_email: string; temp_password: string }>(
    '/api/agency/subaccounts',
    { method: 'POST', body: JSON.stringify(body) },
  );
}

export async function setSubaccountFeature(orgId: string, feature: string, enabled: boolean) {
  return api<{ features: Record<string, boolean> }>(`/api/agency/subaccounts/${orgId}/features`, {
    method: 'PATCH',
    body: JSON.stringify({ feature, enabled }),
  });
}
