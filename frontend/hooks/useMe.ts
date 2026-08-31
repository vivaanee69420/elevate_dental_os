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
