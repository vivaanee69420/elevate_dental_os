'use client';

import { useEffect, useMemo } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useMe } from '@/hooks/useMe';
import { accessibleRouteIds } from '@/lib/permissions';

// Bounces a role away from a page its permissions do not cover — a direct URL,
// or the post-login /business-hub redirect landing somewhere it cannot go.
//
// This used to hard-code the analyst to the Data Room, which meant an owner
// could grant an analyst another section in the Team Permissions matrix and the
// analyst would still be thrown back to /data-summaries. The guard now reads the
// same permission-derived nav the sidebar does, so whatever the owner grants is
// where the analyst may land, and whatever they revoke is bounced.
//
// Applies to the analyst only: every other role already has Overview routes,
// which carry no permission key, so they always have somewhere to be.
// Backend permission gates remain the real boundary; this is navigation.
export function RoleHomeGuard() {
  const { data: me } = useMe();
  const pathname = usePathname();
  const router = useRouter();

  const allowed = useMemo(
    () =>
      me?.role === 'analyst'
        ? accessibleRouteIds(me.role, me.permissions, me.features)
        : [],
    [me?.role, me?.permissions, me?.features],
  );

  useEffect(() => {
    if (me?.role !== 'analyst') return;
    // No accessible route at all (every key revoked): redirecting would loop,
    // so leave the page to render its own empty/permission state.
    if (allowed.length === 0) return;
    const routeId = (pathname || '/').replace(/^\//, '').split('/')[0];
    if (allowed.includes(routeId)) return;
    router.replace(`/${allowed[0]}`);
  }, [me?.role, allowed, pathname, router]);

  return null;
}
