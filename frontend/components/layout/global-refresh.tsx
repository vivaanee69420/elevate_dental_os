'use client';
import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useMe } from '@/hooks/useMe';
import { useSyncAll } from '@/features/integrations/hooks';

// Global refresh: pulls the latest data (incremental only) from every connected
// integration — Dentally, GoHighLevel, Google Ads, Meta Ads, QuickBooks.
// Owner-only (integration sync is owner-gated on the backend). The pulls run
// fire-and-forget server-side, so we hold the spinner for a settle window then
// invalidate every cached query so fresh rows surface across the app.
const SETTLE_MS = 12_000;

export function GlobalRefresh() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const syncAll = useSyncAll();
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only owners can trigger integration syncs; hide for everyone else.
  if (me?.role !== 'owner') return null;

  async function refresh() {
    if (syncing) return;
    setError(null);
    setSyncing(true);
    try {
      await syncAll.mutateAsync();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Refresh failed');
      setSyncing(false);
      return;
    }
    // Trigger returns immediately; the pulls land seconds later. Give them a
    // settle window, then refresh every data surface and stop the spinner.
    setTimeout(() => {
      qc.invalidateQueries();
      setSyncing(false);
    }, SETTLE_MS);
  }

  return (
    <button
      onClick={refresh}
      disabled={syncing}
      title={
        error
          ? error
          : syncing
            ? 'Fetching the latest data from your integrations…'
            : 'Refresh: pull the latest data from all connected integrations'
      }
      aria-label="Refresh data from integrations"
      className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-sm text-ink-muted hover:text-brand hover:bg-bg disabled:opacity-60 disabled:cursor-default transition"
    >
      <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
      <span className="hidden sm:inline">{syncing ? 'Syncing…' : 'Refresh'}</span>
    </button>
  );
}
