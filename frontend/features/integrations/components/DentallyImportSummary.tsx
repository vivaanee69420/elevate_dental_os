'use client';
// What has actually landed from Dentally.
//
// The tile's only signal used to be `last_sync_at`, which is stamped once, on
// completion. A pull 4,000 rows in and a pull that never started both read
// "Synced never", and a run that died at 90% read that way forever. These are
// row counts, so they move while the import runs and they stay truthful if it
// stops early.
//
// Counts only — no patient rows are read to produce them.

import { useQuery } from '@tanstack/react-query';
import { getDentallyImportSummary } from '../api';
import { useSyncToast } from '../sync-toast';

const ROWS: { key: keyof ReturnType<typeof keys>; label: string }[] = [
  { key: 'practices', label: 'Practices' },
  { key: 'contacts', label: 'Patients' },
  { key: 'appointments', label: 'Appointments' },
  { key: 'payments', label: 'Payments' },
  { key: 'invoices', label: 'Invoices' },
  { key: 'treatment_plans', label: 'Treatment plans' },
  { key: 'associates', label: 'Clinicians' },
  { key: 'staff', label: 'Staff' },
];
// Only here to give ROWS a key type without repeating the shape.
function keys() {
  return {
    practices: 0, contacts: 0, appointments: 0, payments: 0,
    invoices: 0, treatment_plans: 0, associates: 0, staff: 0,
  };
}

const nf = new Intl.NumberFormat('en-GB');

function when(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

export function DentallyImportSummary() {
  const { active } = useSyncToast();
  const running = active.has('dentally');

  const { data, isLoading, error } = useQuery({
    queryKey: ['integrations', 'dentally', 'import-summary'],
    queryFn: getDentallyImportSummary,
    // While a pull is in flight the numbers are the progress indicator, so keep
    // them moving; otherwise leave the server alone.
    refetchInterval: running ? 4000 : false,
    staleTime: running ? 0 : 30_000,
  });

  if (isLoading || error || !data) return null;

  const live = running || data.running;
  const total = Object.values(data.counts).reduce<number>((a, b) => a + (b ?? 0), 0);

  return (
    <div
      style={{
        marginTop: 12,
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: 14,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <h4 style={{ fontSize: 14, fontWeight: 600 }} className="text-ink">
          Data in this account
        </h4>
        {live ? (
          <span style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span
              aria-hidden="true"
              style={{
                width: 6, height: 6, borderRadius: '50%',
                background: 'var(--brand-600)',
                animation: 'pulse 1.4s ease-in-out infinite',
              }}
            />
            <span style={{ color: 'var(--brand-600)', fontWeight: 500 }}>Pulling now</span>
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

      {total === 0 ? (
        <p className="text-ink-muted" style={{ fontSize: 12.5, marginTop: 6 }}>
          Nothing pulled yet.
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
            {ROWS.map((r) => {
              const n = data.counts[r.key];
              return (
                <div key={r.key}>
                  <div
                    className="text-ink"
                    style={{ fontSize: 18, fontWeight: 600, lineHeight: 1.2 }}
                  >
                    {/* null means the count could not be read — not zero. */}
                    {n === null ? '—' : nf.format(n)}
                  </div>
                  <div className="text-ink-muted" style={{ fontSize: 11.5 }}>{r.label}</div>
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

      {data.last_error && (
        <p style={{ fontSize: 12, marginTop: 8, color: 'var(--danger, #b91c1c)' }}>
          Last run stopped: {data.last_error}
        </p>
      )}

      <style>{`@keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: .25 } }`}</style>
    </div>
  );
}
