'use client';
// Global sync-toast provider. The progress overlay used to live inside each
// integration panel, so navigating away from the integrations page unmounted it
// and the running import "vanished". This provider lives in the dashboard layout
// (above the routed pages), so the toast survives client-side navigation — start
// a sync on the integrations page, keep working anywhere, and the live progress
// stays pinned top-right until it finishes (or you close it).
//
// State is a Set of provider keys currently syncing; any panel calls start(p) to
// surface the toast for provider p. The toast self-removes via onDone when the
// sync completes or the user closes it.

import { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react';
import SyncOverlay from './components/SyncOverlay';
import { useFinishSync, useIntegrations } from './hooks';
import { getSyncProgress } from './api';

// Providers that run a pollable on-demand sync (mirrors the backend set).
const SYNCABLE = new Set(['dentally', 'gohighlevel', 'google_ads', 'meta_ads', 'quickbooks', 'xero']);
// A sync whose last progress write is older than this is treated as dead (the
// web process restarted) — don't resurrect its toast on reload.
const FRESH_MS = 120_000;

interface SyncToastCtx {
  active: Set<string>;
  start: (provider: string) => void;
}

const Ctx = createContext<SyncToastCtx | null>(null);

// Tolerate use outside the provider (a panel rendered in isolation, e.g. a test
// or a non-dashboard route): return a no-op so nothing crashes — the toast just
// won't show there.
export function useSyncToast(): SyncToastCtx {
  return useContext(Ctx) ?? { active: new Set(), start: () => {} };
}

export function SyncToastProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<Set<string>>(() => new Set());
  const finishSync = useFinishSync();

  const start = useCallback((provider: string) => {
    setActive((prev) => (prev.has(provider) ? prev : new Set(prev).add(provider)));
  }, []);
  const stop = useCallback((provider: string) => {
    setActive((prev) => {
      if (!prev.has(provider)) return prev;
      const next = new Set(prev);
      next.delete(provider);
      return next;
    });
  }, []);

  // Reload self-resurrect: a sync keeps running server-side across a full page
  // reload, but client toast state is lost. On first mount, check each connected
  // provider's progress once and re-show any sync that is still running and
  // fresh — so refreshing the page doesn't make the import look like it stopped.
  const { data: integrationsData } = useIntegrations();
  const resurrectedRef = useRef(false);
  useEffect(() => {
    if (resurrectedRef.current || !integrationsData) return;
    resurrectedRef.current = true;
    const connected = (integrationsData.integrations ?? []).filter(
      (i) => i.status === 'active' && SYNCABLE.has(i.provider),
    );
    connected.forEach(async (i) => {
      try {
        const p = await getSyncProgress(i.provider);
        const fresh = !!p?.at && Date.now() - p.at < FRESH_MS;
        if (p?.running && !p.done && fresh) start(i.provider);
      } catch {
        // owner-only endpoint / transient error — just skip resurrection.
      }
    });
  }, [integrationsData, start]);

  return (
    <Ctx.Provider value={{ active, start }}>
      {children}
      {/* Fixed stacking column top-right; non-interactive except the cards
          themselves (each card re-enables pointer events). Multiple concurrent
          syncs (e.g. Dentally + GoHighLevel) stack with a gap. */}
      {active.size > 0 && (
        <div
          style={{
            position: 'fixed', top: 16, right: 16, zIndex: 2000,
            display: 'flex', flexDirection: 'column', gap: 12, pointerEvents: 'none',
          }}
        >
          {[...active].map((provider) => (
            <SyncOverlay
              key={provider}
              provider={provider}
              onDone={() => { finishSync(); stop(provider); }}
            />
          ))}
        </div>
      )}
    </Ctx.Provider>
  );
}
