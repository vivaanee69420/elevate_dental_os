'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useMe } from '@/hooks/useMe';
import { isDataRoomRoute } from '@/lib/permissions';

// The analyst role is confined to the Data Room. Nav already hides everything
// else; this bounces a direct URL (or the post-login /business-hub redirect)
// to the first Data Room page. Backend guards remain the real boundary —
// every non-Data-Room API 403s an analyst regardless of this component.
export function RoleHomeGuard() {
  const { data: me } = useMe();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (me?.role !== 'analyst') return;
    const routeId = (pathname || '/').replace(/^\//, '').split('/')[0];
    if (!isDataRoomRoute(routeId)) router.replace('/data-summaries');
  }, [me?.role, pathname, router]);

  return null;
}
