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

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import SyncOverlay from './components/SyncOverlay';
import { useFinishSync } from './hooks';

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
