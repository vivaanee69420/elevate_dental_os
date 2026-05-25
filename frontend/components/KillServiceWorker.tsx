'use client';

import { useEffect } from 'react';

/**
 * Permanent kill-switch for any service worker on this origin.
 *
 * Why this exists: a stale dev-session service worker can hijack
 * /_next/static/* requests and break the build (raw HTML, no CSS/JS).
 *
 * Boot sequence:
 *  1. Unregister any existing worker + purge caches.
 *  2. Register OUR kill-switch SW at /sw.js. On activate it nukes caches +
 *     unregisters itself + force-reloads open clients. Next paint is clean.
 *  3. Subsequent navigations have no SW registered — nothing intercepts.
 *
 * Caveat: if the user is ALREADY on a page that was hijacked (no React JS
 * loaded), this component never runs. They must hard-reload once
 * (Cmd+Shift+R). After that, this component prevents recurrence.
 */
export function KillServiceWorker() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    (async () => {
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
        if ('caches' in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
        }
        try {
          await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        } catch (_) {
          // No SW support / register blocked — irrelevant, we had nothing to clean.
        }
      } catch (err) {
        console.warn('[KillServiceWorker] failed', err);
      }
    })();
  }, []);

  return null;
}
