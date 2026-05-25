'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { usePlatformMe } from '@/hooks/usePlatformMe';

// Forces a flagged admin to the change-password screen. The backend is the
// real gate (platformAuthenticate 403s every other route while
// must_change_password is set); this just turns that 403 into a clean
// redirect instead of broken pages.
//
// Reads the shared cached usePlatformMe() so this guard and the topbar avatar
// share one /me request instead of two per navigation.
export function MustChangePasswordGuard() {
  const router = useRouter();
  const pathname = usePathname();
  const { data: me } = usePlatformMe();

  useEffect(() => {
    if (pathname === '/platform/change-password') return;
    if (me?.must_change_password) router.replace('/platform/change-password');
  }, [pathname, me, router]);

  return null;
}
