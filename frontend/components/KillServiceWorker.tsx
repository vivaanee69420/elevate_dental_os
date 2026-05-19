'use client';

import { useEffect } from 'react';

/**
 * This app does not use a service worker. A stale worker from a previous
 * app on the same localhost origin can hijack /_next/static/* requests and
 * break the build (MIME errors, blank dashboard). Unregister any worker and
 * purge its caches on boot. Safe no-op when none exist.
 */
export function KillServiceWorker() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.getRegistrations().then((regs) => {
      regs.forEach((r) => r.unregister());
    });
    if ('caches' in window) {
      caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
    }
  }, []);

  return null;
}
