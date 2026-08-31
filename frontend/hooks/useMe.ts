'use client';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Permissions } from '@/lib/permissions';

export interface Me {
  id: string;
  email?: string;
  full_name?: string;
  role: string;
  organisation_id: string;
  organisation_name?: string;
  permissions?: Permissions;
  /** True once email/WhatsApp delivery is configured — gates the invite UI. */
  invite_enabled?: boolean;
  /** Enabled org-level feature keys (agency model). Absent on older backends. */
  features?: string[];
  /** Agency shape (A2). Absent on older backends. */
  agency?: {
    is_agency_actor: boolean;
    switched: boolean;
    home_org: { id: string; name: string } | null;
  };
}

/**
 * Agency-actor check. Agency access is a per-user grant, so this FAILS CLOSED:
 * an absent `agency` field (older backend, or a stale cached /auth/me) means
 * no agency UI. The previous `role === 'owner'` fallback showed the Agency
 * menu and mapping controls to every org owner whenever the field was missing.
 */
export function isAgencyActor(me: Me | undefined): boolean {
  return me?.agency?.is_agency_actor === true;
}

// Single shared, cached /auth/me. Before this, sidebar + topbar (and the
// team screen) each fetched /auth/me on every mount/navigation — 3+ serial
// backend round-trips per page, each doing a Supabase getUser + DB read.
// React Query dedupes concurrent callers and caches across navigations, so
// the app makes ONE /auth/me request per session window.
export function useMe() {
  return useQuery<Me>({
    queryKey: ['me'],
    queryFn: () => api<Me>('/auth/me'),
    staleTime: 5 * 60_000, // 5 min — identity rarely changes mid-session
    gcTime: 10 * 60_000,
    retry: false, // unauthenticated -> fail fast, don't hammer
    refetchOnWindowFocus: false,
  });
}
