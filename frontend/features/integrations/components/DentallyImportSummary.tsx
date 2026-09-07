'use client';
// What has actually landed from Dentally, updating while it lands.
//
// The tile's only signal used to be `last_sync_at`, which is stamped once, on
// completion. A pull 4,000 rows in and a pull that never started both read
// "Synced never", and a run that died at 90% read that way forever. These are
// row counts, so they move during the import and stay truthful if it stops.
//
// Live-ness is driven by the SERVER's own running flag, not by whether the
// sync toast happens to be on screen. The toast is per-tab state: reloading the
// page mid-pull cleared it, and the panel then sat frozen beside an import that
// was still going — the exact thing it exists to show.
//
// Counts only — no row bodies are read to produce them.

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getDentallyImportSummary, getSyncProgress, resumeDentallyImport } from '../api';
import { useSyncToast } from '../sync-toast';

// A progress record whose last write is older than this is treated as dead: the
// backend process restarted mid-run and nothing will ever mark it finished.
// Matches the sync toast's own staleness rule.
const STALE_MS = 120_000;
const COUNTS_MS = 3000;
const PROGRESS_MS = 2000;

const FIELDS = [
  ['practices', 'Practices'],
  ['contacts', 'Patients'],
  ['appointments', 'Appointments'],
  ['payments', 'Payments'],
  ['invoices', 'Invoices'],
  ['treatment_plans', 'Treatment plans'],
  ['associates', 'Clinicians'],
  ['staff', 'Staff'],
] as const;

const nf = new Intl.NumberFormat('en-GB');

function when(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

/** "treatment_plans" -> "Treatment plans" */
function phaseLabel(phase: string): string {
  const s = phase.replace(/_/g, ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : '';
}

export function DentallyImportSummary() {
  const { active, start } = useSyncToast();
  const qc = useQueryClient();
  const startedHere = active.has('dentally');
  const [resuming, setResuming] = useState(false);
  const [resumeErr, setResumeErr] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['integrations', 'dentally', 'import-summary'],
    queryFn: getDentallyImportSummary,
    // The server decides whether to keep polling, so this survives a reload.
    refetchInterval: (q) => (q.state.data?.running || startedHere ? COUNTS_MS : false),
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

  const live = Boolean(data?.running) || startedHere;

  // Phase and percentage, so the panel says WHAT it is pulling, not only that
  // something is happening. Only fetched while a run is actually in flight.
  const { data: progress } = useQuery({
    queryKey: ['integrations', 'dentally', 'sync-progress'],
    queryFn: () => getSyncProgress('dentally'),
    enabled: live,
    refetchInterval: live ? PROGRESS_MS : false,
    // Same reason as useSyncProgress: a background tab must not freeze a view
    // of work happening on the server.
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

  if (isLoading || error || !data) return null;

  const total = Object.values(data.counts).reduce<number>((a, b) => a + (b ?? 0), 0);
  // A run whose progress stopped being written is not running, whatever the
  // flag says. Saying "Pulling now" over a dead process is the same lie as
  // "Synced never" over 4,000 rows, pointed the other way.
  const stalled = live && !!progress?.at && Date.now() - progress.at > STALE_MS;
  const pct = Math.max(0, Math.min(100, Math.round(progress?.pct ?? 0)));

  return (
    <div style={{ marginTop: 12, border: '1px solid var(--border)', borderRadius: 12, padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <h4 style={{ fontSize: 14, fontWeight: 600 }} className="text-ink">
          Data in this account
        </h4>

        {live && !stalled ? (
          <span style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span
              aria-hidden="true"
              style={{
                width: 6, height: 6, borderRadius: '50%',
                background: 'var(--brand-600)',
                animation: 'elevate-pulse 1.4s ease-in-out infinite',
              }}
            />
            <span style={{ color: 'var(--brand-600)', fontWeight: 500 }}>
              {progress?.phase ? `Pulling ${phaseLabel(progress.phase).toLowerCase()}` : 'Pulling now'}
              {progress?.pct ? ` · ${pct}%` : ''}
            </span>
          </span>
        ) : stalled || data.interrupted ? (
          <span style={{ fontSize: 12, color: 'var(--warning, #92400e)', fontWeight: 500 }}>
            Import stopped
          </span>
        ) : data.last_sync_at ? (
          <span className="text-ink-muted" style={{ fontSize: 12 }}>
            Last completed {when(data.last_sync_at)}
          </span>
        ) : total > 0 ? (
          // The honest state the old panel could not express: rows are here,
          // but no run has ever reported finishing.
          <span className="text-ink-muted" style={{ fontSize: 12 }}>
            No completed sync yet
          </span>
        ) : null}
      </div>

      {live && !stalled && (
        <div
          aria-hidden="true"
          style={{
            marginTop: 8, height: 3, borderRadius: 999,
            background: 'var(--border)', overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${pct || 4}%`,
              background: 'var(--brand-600)',
              transition: 'width .4s ease',
            }}
          />
        </div>
      )}

      {total === 0 ? (
        <p className="text-ink-muted" style={{ fontSize: 12.5, marginTop: 8 }}>
          {live ? 'Waiting for the first records…' : 'Nothing pulled yet.'}
        </p>
      ) : (
        <>
          <div
            style={{
              marginTop: 10,
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))',
              gap: 10,
            }}
          >
            {FIELDS.map(([key, label]) => {
              const n = data.counts[key];
              return (
                <div key={key}>
                  <div
                    className="text-ink"
                    style={{
                      fontSize: 18, fontWeight: 600, lineHeight: 1.2,
                      fontVariantNumeric: 'tabular-nums', // digits must not jitter as they tick up
                    }}
                  >
                    {/* null means the count could not be read — not zero. */}
                    {n === null ? '—' : nf.format(n)}
                  </div>
                  <div className="text-ink-muted" style={{ fontSize: 11.5 }}>{label}</div>
                </div>
              );
            })}
          </div>

          {data.appointments_from && data.appointments_to && (
            <p className="text-ink-muted" style={{ fontSize: 12, marginTop: 10 }}>
              Appointments span {when(data.appointments_from)} to {when(data.appointments_to)}.
            </p>
          )}
        </>
      )}

      {/* Why it stopped, and the way out. A partial import with no explanation
          and no button is the state that made this whole panel necessary. */}
      {/* `stalled` is only ever computed while `live` is true (a running flag
          whose progress went cold), so it must NOT be gated on !live — that
          combination is unreachable and the banner would never show for the
          very case it was written for. */}
      {(stalled || (data.interrupted && !live)) && (
        <div
          style={{
            marginTop: 12,
            border: '1px solid var(--warning-border, #FDE68A)',
            background: 'var(--warning-bg, #FFFBEB)',
            borderRadius: 10,
            padding: 12,
          }}
        >
          <p style={{ fontSize: 12.5, color: 'var(--warning-ink, #92400E)' }}>
            {data.stopped_reason ??
              'The import stopped before it finished. The counts above are what arrived.'}
          </p>
          <p style={{ fontSize: 12, marginTop: 4 }} className="text-ink-muted">
            Resuming carries on from where it stopped — the parts already pulled are
            not fetched again.
          </p>
          {resumeErr && (
            <p style={{ fontSize: 12, marginTop: 6, color: 'var(--danger, #b91c1c)' }}>{resumeErr}</p>
          )}
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              type="button"
              disabled={resuming || !data.can_resume}
              className="btn-primary"
              style={{ opacity: resuming || !data.can_resume ? 0.5 : 1 }}
              onClick={async () => {
                setResuming(true);
                setResumeErr('');
                try {
                  await resumeDentallyImport();
                  start('dentally');
                  await qc.invalidateQueries({ queryKey: ['integrations', 'dentally'] });
                } catch (e) {
                  setResumeErr((e as Error).message);
                } finally {
                  setResuming(false);
                }
              }}
            >
              {resuming ? 'Resuming…' : 'Resume import'}
            </button>
            {!data.can_resume && (
              <span className="text-ink-muted" style={{ fontSize: 12 }}>
                Tried {data.attempts} times without finishing — worth checking the
                Dentally connection before retrying.
              </span>
            )}
          </div>
        </div>
      )}

      <style>{`@keyframes elevate-pulse { 0%,100% { opacity: 1 } 50% { opacity: .25 } }`}</style>
    </div>
  );
}
