'use client';
// Full-screen sync loader with a live percentage bar. Polls the server's
// in-memory progress (~1/s) while mounted, and calls onDone when the sync
// finishes so the parent can refresh data + unmount the overlay.

import { useEffect } from 'react';
import { useSyncProgress } from '../hooks';

const PHASE_LABEL: Record<string, string> = {
  starting: 'Starting…',
  patients: 'Patients',
  appointments: 'Appointments',
  payments: 'Payments',
  idle: 'Working…',
};

export default function SyncOverlay({
  provider,
  onDone,
}: {
  provider: string;
  onDone?: () => void;
}) {
  const { data } = useSyncProgress(provider, true);
  const done = !!data?.done;

  useEffect(() => {
    if (done) onDone?.();
  }, [done]); // eslint-disable-line react-hooks/exhaustive-deps

  const pct = Math.min(100, Math.max(0, data?.pct ?? 0));
  const phase = PHASE_LABEL[data?.phase ?? 'starting'] ?? data?.phase ?? 'Working…';
  const errored = !!data?.error;

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
          background: 'white', minWidth: 320, textAlign: 'center',
          boxShadow: '0 10px 40px rgba(0,0,0,0.12)',
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>
          {errored ? 'Sync failed' : 'Syncing Dentally data'}
        </div>
        <div className="text-ink-muted" style={{ fontSize: 12, marginBottom: 14 }}>
          {errored ? data?.error : `${phase} · ${pct}%`}
        </div>
        {/* progress track */}
        <div style={{ height: 8, width: '100%', background: '#E5E7EB', borderRadius: 999, overflow: 'hidden' }}>
          <div
            style={{
              height: '100%', width: `${pct}%`,
              background: errored ? 'var(--danger, #DC2626)' : '#0E7C7B',
              borderRadius: 999, transition: 'width 0.4s ease',
            }}
          />
        </div>
        <div className="text-ink-muted" style={{ fontSize: 11, marginTop: 12 }}>
          {data?.totalPages
            ? `Page ${data.page ?? 0} of ${data.totalPages}`
            : 'Pulling from Dentally — large practices take a little longer.'}
        </div>
      </div>
    </div>
  );
}
