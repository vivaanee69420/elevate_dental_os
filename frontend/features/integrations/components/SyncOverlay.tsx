'use client';
// Full-screen sync loader with a live percentage bar. Polls the server's
// in-memory progress (~1/s) while mounted, and calls onDone when the sync
// finishes so the parent can refresh data + unmount the overlay.
//
// Progress lives in the web process's memory and is lost on restart (deploy,
// dyno recycle). Without a guard, that strands the bar at its last value
// (typically the 99% ceiling) with no `done` and no `error` — a permanent
// "stuck at 99%". So we watch for the polled payload going stale: if nothing
// changes for STALL_MS and we're not done, drop the frozen bar and let the user
// close. A Close button is ALWAYS present so the user is never trapped.

import { useEffect, useRef, useState } from 'react';
import { useSyncProgress } from '../hooks';

const PHASE_LABEL: Record<string, string> = {
  starting: 'Starting…',
  practitioners: 'Practitioners',
  staff: 'Staff',
  patients: 'Patients',
  appointments: 'Appointments',
  payments: 'Payments',
  treatment_plans: 'Treatment plans',
  invoices: 'Invoices',
  invoice_items: 'Invoice items',
  linking: 'Linking records',
  contacts: 'Contacts',
  opportunities: 'Opportunities',
  conversations: 'Conversations',
  idle: 'Working…',
};

// Human provider name for the overlay copy (the sync feeds different resources
// per provider, so the title/subtitle shouldn't hard-code "Dentally").
const PROVIDER_LABEL: Record<string, string> = {
  dentally: 'Dentally',
  gohighlevel: 'GoHighLevel',
  xero: 'Xero',
  google_ads: 'Google Ads',
  meta_ads: 'Meta Ads',
};

// No change to the polled payload for this long (and not done) => treat as
// stalled. Comfortably longer than the ~1s poll + the brief gap while the final
// relink RPCs run, so a healthy sync never trips it.
const STALL_MS = 75_000;

export default function SyncOverlay({
  provider,
  onDone,
}: {
  provider: string;
  onDone?: () => void;
}) {
  const { data } = useSyncProgress(provider, true);
  const done = !!data?.done;
  const errored = !!data?.error;

  useEffect(() => {
    if (done) onDone?.();
  }, [done]); // eslint-disable-line react-hooks/exhaustive-deps

  // Track when the polled payload last *changed* (client clock). count/pct/at
  // all advance on a live sync; when they freeze, the sync stopped feeding us.
  const sig = JSON.stringify([data?.pct, data?.count, data?.phase, data?.done, data?.at]);
  const sigRef = useRef(sig);
  const lastChangeRef = useRef(Date.now());
  if (sig !== sigRef.current) {
    sigRef.current = sig;
    lastChangeRef.current = Date.now();
  }
  // Re-render on a timer so the stall is re-evaluated even when polls return an
  // identical payload (a frozen progress never changes, so nothing else would
  // trigger the check).
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, []);
  const stalled = !done && !errored && Date.now() - lastChangeRef.current > STALL_MS;

  // High-water mark: progress polls can briefly arrive out of order (phase
  // boundary, slow/overlapping poll), so never let the bar visibly retreat.
  const maxPct = useRef(0);
  const rawPct = Math.min(100, Math.max(0, data?.pct ?? 0));
  if (rawPct > maxPct.current) maxPct.current = rawPct;
  const pct = maxPct.current;
  const phase = PHASE_LABEL[data?.phase ?? 'starting'] ?? data?.phase ?? 'Working…';
  const providerLabel = PROVIDER_LABEL[provider] ?? provider;

  const title = errored ? 'Sync failed' : stalled ? 'Still importing in the background' : `Syncing ${providerLabel} data`;
  const subtitle = errored
    ? data?.error
    : stalled
      ? 'No update for a while — the server may have restarted mid-import, or the connection dropped. Your data keeps importing on the server; close this and check back shortly.'
      : `${phase} · ${pct}%`;
  const barColour = errored ? 'var(--danger, #DC2626)' : stalled ? '#D97706' : 'var(--brand)';

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 2000,
        background: 'rgba(255,255,255,0.72)', backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        className="card-padded"
        style={{
          background: 'white', minWidth: 320, maxWidth: 420, textAlign: 'center',
          boxShadow: '0 10px 40px rgba(0,0,0,0.12)', position: 'relative',
        }}
      >
        {/* Always-present escape hatch — the user is never trapped behind a
            frozen bar. Refreshes data + unmounts via the parent's onDone. */}
        <button
          onClick={() => onDone?.()}
          aria-label="Close"
          title="Close"
          style={{
            position: 'absolute', top: 8, right: 10, background: 'none',
            border: 'none', cursor: 'pointer', fontSize: 18, lineHeight: 1,
            color: 'var(--ink-muted, var(--ink-muted))',
          }}
        >
          ×
        </button>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>
          {title}
        </div>
        <div className="text-ink-muted" style={{ fontSize: 12, marginBottom: 14 }}>
          {subtitle}
        </div>
        {/* progress track */}
        <div style={{ height: 8, width: '100%', background: 'var(--border)', borderRadius: 999, overflow: 'hidden' }}>
          <div
            style={{
              height: '100%', width: `${pct}%`,
              background: barColour,
              borderRadius: 999, transition: 'width 0.4s ease',
            }}
          />
        </div>
        <div className="text-ink-muted" style={{ fontSize: 11, marginTop: 12 }}>
          {/* Live record count is the clearest "what's happening" signal —
              Dentally usually omits total_pages, so we lead with records pulled,
              fall back to page-of-total when present, then a generic message. */}
          {data?.count
            ? `${data.count.toLocaleString('en-GB')} ${(PHASE_LABEL[data?.phase ?? ''] ?? 'records').toLowerCase()} pulled so far`
            : data?.totalPages
              ? `Page ${data.page ?? 0} of ${data.totalPages}`
              : `Pulling from ${providerLabel} — large accounts take a little longer.`}
        </div>
        {!errored && !stalled && (
          <div className="text-ink-muted" style={{ fontSize: 11, marginTop: 6 }}>
            Sit back for a few minutes while we pull your data — you can leave this open, it will finish on its own.
          </div>
        )}
        {(errored || stalled) && (
          <button
            onClick={() => onDone?.()}
            style={{
              marginTop: 14, padding: '8px 16px', border: '1px solid var(--border)',
              borderRadius: 6, fontSize: 12, fontWeight: 600, background: 'white', cursor: 'pointer',
            }}
          >
            Close
          </button>
        )}
      </div>
    </div>
  );
}
