'use client';
// Non-blocking sync toast (top-right) with a live percentage bar. Polls the
// server's in-memory progress (~1/s) while mounted, and calls onDone when the
// sync finishes so the parent can refresh data + unmount the overlay. No
// backdrop — the app stays usable while the import runs in the background.
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
  // Per-phase rows in pull order (insertion order of the server's phases map).
  const phaseList = data?.phases ? Object.values(data.phases) : [];
  const activeIdx = data?.phase ? phaseList.findIndex((p) => p.phase === data.phase) : -1;

  const title = errored ? 'Sync failed' : stalled ? 'Still importing in the background' : `Syncing ${providerLabel} data`;
  const subtitle = errored
    ? data?.error
    : stalled
      ? 'No update for a while — the import looks like it stopped (a server restart or dropped connection). Whatever was already pulled is saved. Close this, then run the sync again: a full pull resumes from where it left off, it does not start over.'
      : `${phase} · ${pct}%`;
  const barColour = errored ? 'var(--danger, #DC2626)' : stalled ? '#D97706' : 'var(--brand)';

  return (
    // Non-blocking toast card. Positioning + stacking is owned by the global
    // SyncToastProvider's fixed column (top-right), so this renders as a plain
    // card and re-enables pointer events on itself (the column disables them).
    <div
      className="card-padded"
      style={{
        background: 'white', minWidth: 300, maxWidth: 360, textAlign: 'left',
        boxShadow: '0 10px 40px rgba(0,0,0,0.18)', position: 'relative',
        border: '1px solid var(--border)', borderRadius: 12, pointerEvents: 'auto',
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
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4, paddingRight: 18 }}>
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
        {/* Per-phase breakdown — one row per resource as the sync reaches it
            (Contacts, Opportunities, Conversations…). Phases arrive in pull
            order; the active one shows count + live %, completed ones a tick +
            final count, not-yet-reached ones "Waiting". Falls back to a single
            line before any phase is known. */}
        {phaseList.length > 0 ? (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {phaseList.map((p, i) => {
              // Phases are listed in pull order; the active one splits completed
              // (before it) from waiting (after it). activeIdx -1 = still starting.
              const isComplete = !errored && (done || (activeIdx >= 0 && i < activeIdx));
              const isActive = !done && !errored && !stalled && i === activeIdx;
              const isPending = !isComplete && !isActive && !stalled && (activeIdx < 0 || i > activeIdx);
              const label = PHASE_LABEL[p.phase] ?? p.phase;
              const dot = isComplete ? '#16A34A' : isActive ? 'var(--brand)' : isPending ? 'var(--border)' : '#D97706';
              const right = isComplete
                ? (p.count ? `${p.count.toLocaleString('en-GB')} pulled` : 'Done')
                : isPending
                  ? 'Waiting'
                  : (p.count ? `${p.count.toLocaleString('en-GB')} · ${p.pct}%` : `${p.pct}%`);
              return (
                <div key={p.phase} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                    <span style={{ width: 7, height: 7, borderRadius: 999, background: dot, flex: '0 0 auto' }} />
                    <span style={{ color: 'var(--ink)' }}>{label}</span>
                  </span>
                  <span className="text-ink-muted" style={{ flex: '0 0 auto' }}>{right}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-ink-muted" style={{ fontSize: 11, marginTop: 12 }}>
            {/* Before any phase is reported: lead with records pulled, fall back
                to page-of-total when present, then a generic message. */}
            {data?.count
              ? `${data.count.toLocaleString('en-GB')} ${(PHASE_LABEL[data?.phase ?? ''] ?? 'records').toLowerCase()} pulled so far`
              : data?.totalPages
                ? `Page ${data.page ?? 0} of ${data.totalPages}`
                : `Pulling from ${providerLabel} — large accounts take a little longer.`}
          </div>
        )}
        {!errored && !stalled && (
          <div className="text-ink-muted" style={{ fontSize: 11, marginTop: 8 }}>
            You can keep working — this runs in the background and finishes on its own.
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
  );
}
