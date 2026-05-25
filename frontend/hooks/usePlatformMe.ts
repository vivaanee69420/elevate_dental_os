'use client';
import { useQuery } from '@tanstack/react-query';
import { platformApi } from '@/lib/platform-api';

export interface PlatformMe {
  id: string;
  email?: string;
  full_name?: string;
  /** Platform tier. After migration ...000012 the only valid value is 'superadmin'. */
  role: string;
  must_change_password?: boolean;
  last_login_at?: string | null;
  created_at?: string;
}

// Single shared, cached platform /me. Mirrors hooks/useMe.ts for the tenant
// app. Before this, MustChangePasswordGuard fetched /me on every platform
// navigation and any other consumer (e.g. the topbar avatar) would have
// fetched it again. React Query dedupes concurrent callers and caches across
// navigations, so the platform area makes ONE /me request per session window.
export function usePlatformMe() {
  return useQuery<PlatformMe>({
    queryKey: ['platform-me'],
    queryFn: () => platformApi<PlatformMe>('/me'),
    staleTime: 5 * 60_000, // 5 min — identity rarely changes mid-session
    gcTime: 10 * 60_000,
    retry: false, // unauthenticated -> fail fast (proxy 401 -> /login)
    refetchOnWindowFocus: false,
  });
}
