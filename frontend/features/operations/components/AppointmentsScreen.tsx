'use client';
// Appointments (Operations) — appointments pulled from the live Dentally sync.
// Unlike the other Operations screens this is REAL data: it hits
// GET /api/appointments (backend orders by starts_at asc, supports from/to/
// practice_id filters). The view defaults to Upcoming but the user can switch
// to Past or All, pick a custom date range, and filter by practice.

import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { usePractices } from '@/features/integrations/hooks';

const PER_PAGE = 25;

// Toggle presets. Custom date inputs override these when either is set.
type View = 'upcoming' | 'past' | 'all';
const VIEWS: { key: View; label: string }[] = [
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'past', label: 'Past' },
  { key: 'all', label: 'All' },
];

// Midnight today (local), so an appointment earlier today still counts as upcoming.
function midnightTodayISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

type Appointment = {
  id: string;
  starts_at: string;
  ends_at: string | null;
  status: string;
  appointment_type: string | null;
  contact: { id: string; first_name: string | null; last_name: string | null } | null;
  practice: { id: string; name: string | null } | null;
  associate: { id: string; full_name: string | null } | null;
};

// Status pill colours. Open appointments are mostly scheduled/confirmed/
// in_progress; the closed states are kept for completeness (a refresh can flip
// one before this view reloads).
const STATUS_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  scheduled: { bg: '#EEF2FF', fg: '#3730A3', label: 'Scheduled' },
  confirmed: { bg: '#E6F4F1', fg: 'var(--brand)', label: 'Confirmed' },
  in_progress: { bg: '#FEF3C7', fg: '#92400E', label: 'In progress' },
  completed: { bg: '#DCFCE7', fg: '#166534', label: 'Completed' },
  cancelled: { bg: '#FEE2E2', fg: '#991B1B', label: 'Cancelled' },
  no_show: { bg: '#FEE2E2', fg: '#991B1B', label: 'No show' },
};

const dayFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const timeFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

// A patient-less diary block (no linked contact) shows a dash, not a fake name.
function patientName(a: Appointment): string {
  const n = [a.contact?.first_name, a.contact?.last_name].filter(Boolean).join(' ').trim();
  return n || '—';
}

type AppointmentsResponse = {
  appointments: Appointment[];
  total: number;
  page: number;
  per_page: number;
};

export default function AppointmentsScreen() {
  const [view, setView] = useState<View>('upcoming');
  // Custom range inputs hold 'YYYY-MM-DD' (or '' = unset). When either is set
  // they take precedence over the view toggle.
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [practiceId, setPracticeId] = useState('');
  const [page, setPage] = useState(1);

  const { data: practiceData } = usePractices();
  const practices = practiceData?.practices ?? [];

  const hasCustom = customFrom !== '' || customTo !== '';

  // Resolve the from/to the backend gets. Custom dates win; otherwise the
  // toggle: Upcoming = from today, Past = up to today, All = no bounds.
  const { from, to } = useMemo<{ from?: string; to?: string }>(() => {
    if (hasCustom) {
      return {
        from: customFrom ? new Date(`${customFrom}T00:00:00`).toISOString() : undefined,
        to: customTo ? new Date(`${customTo}T23:59:59.999`).toISOString() : undefined,
      };
    }
    if (view === 'upcoming') return { from: midnightTodayISO() };
    if (view === 'past') return { to: midnightTodayISO() };
    return {}; // all
  }, [view, customFrom, customTo, hasCustom]);

  // Any filter change resets to page 1.
  function resetTo(fn: () => void) {
    setPage(1);
    fn();
  }

  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (practiceId) params.set('practice_id', practiceId);
  params.set('page', String(page));
  params.set('per_page', String(PER_PAGE));
  const qs = params.toString();

  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey: ['appointments', qs],
    queryFn: () => api<AppointmentsResponse>(`/api/appointments?${qs}`),
    staleTime: 30_000,
    placeholderData: keepPreviousData, // keep the current page visible while the next loads
  });

  const appointments = data?.appointments ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  return (
    <div className="mx-auto" style={{ maxWidth: 1280 }}>
      <div className="mb-6">
        <h1 className="display font-bold" style={{ fontSize: 28 }}>
          Appointments
        </h1>
        <p className="text-ink-muted" style={{ fontSize: 13 }}>
          Appointments across your practices · live from Dentally
        </p>
      </div>

      <div
        className="card-padded"
        style={{ marginBottom: 16, display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 16 }}
      >
        {/* View toggle — Upcoming / Past / All. Disabled (dimmed) while a custom range is active. */}
        <div>
          <label className="text-ink-muted font-bold uppercase" style={{ display: 'block', fontSize: 11, letterSpacing: '0.05em', marginBottom: 6 }}>
            View
          </label>
          <div style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', opacity: hasCustom ? 0.45 : 1 }}>
            {VIEWS.map((v) => (
              <button
                key={v.key}
                type="button"
                onClick={() => resetTo(() => setView(v.key))}
                style={{
                  padding: '6px 14px',
                  fontSize: 12,
                  fontWeight: 600,
                  border: 'none',
                  borderLeft: v.key === 'upcoming' ? 'none' : '1px solid var(--border)',
                  background: !hasCustom && view === v.key ? 'var(--brand)' : '#FFFFFF',
                  color: !hasCustom && view === v.key ? '#FFFFFF' : 'var(--ink)',
                  cursor: 'pointer',
                }}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>

        {/* Custom date range — overrides the view toggle when either is set. */}
        <div>
          <label className="text-ink-muted font-bold uppercase" style={{ display: 'block', fontSize: 11, letterSpacing: '0.05em', marginBottom: 6 }}>
            From
          </label>
          <input
            type="date"
            value={customFrom}
            max={customTo || undefined}
            onChange={(e) => resetTo(() => setCustomFrom(e.target.value))}
            style={{ padding: '6px 10px', fontSize: 12, border: '1px solid var(--border)', borderRadius: 8, background: '#FFFFFF' }}
          />
        </div>
        <div>
          <label className="text-ink-muted font-bold uppercase" style={{ display: 'block', fontSize: 11, letterSpacing: '0.05em', marginBottom: 6 }}>
            To
          </label>
          <input
            type="date"
            value={customTo}
            min={customFrom || undefined}
            onChange={(e) => resetTo(() => setCustomTo(e.target.value))}
            style={{ padding: '6px 10px', fontSize: 12, border: '1px solid var(--border)', borderRadius: 8, background: '#FFFFFF' }}
          />
        </div>
        {hasCustom && (
          <button
            type="button"
            onClick={() => resetTo(() => { setCustomFrom(''); setCustomTo(''); })}
            className="btn-ghost"
            style={{ padding: '6px 12px', fontSize: 12, border: '1px solid var(--border)', borderRadius: 8 }}
          >
            Clear dates
          </button>
        )}

        {/* Practice filter. */}
        <div>
          <label className="text-ink-muted font-bold uppercase" style={{ display: 'block', fontSize: 11, letterSpacing: '0.05em', marginBottom: 6 }}>
            Practice
          </label>
          <select
            value={practiceId}
            onChange={(e) => resetTo(() => setPracticeId(e.target.value))}
            style={{ padding: '6px 10px', fontSize: 12, border: '1px solid var(--border)', borderRadius: 8, background: '#FFFFFF', minWidth: 160 }}
          >
            <option value="">All practices</option>
            {practices.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="card-padded">
        {isLoading && (
          <div className="space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-5 w-full" />
            ))}
          </div>
        )}

        {isError && (
          <div style={{ fontSize: 13, padding: '24px 0', textAlign: 'center', color: '#991B1B' }}>
            Could not load appointments{error instanceof Error ? `: ${error.message}` : ''}.
          </div>
        )}

        {!isLoading && !isError && appointments.length === 0 && (
          <div className="text-ink-muted" style={{ fontSize: 13, padding: '24px 0', textAlign: 'center' }}>
            No appointments match these filters. They appear here once a Dentally sync has run.
          </div>
        )}

        {!isLoading && !isError && appointments.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr className="text-ink-muted font-bold uppercase" style={{ fontSize: 11, letterSpacing: '0.05em', textAlign: 'left' }}>
                <th style={{ padding: '8px 12px 8px 0' }}>When</th>
                <th style={{ padding: '8px 12px' }}>Patient</th>
                <th style={{ padding: '8px 12px' }}>Practice</th>
                <th style={{ padding: '8px 12px' }}>Clinician</th>
                <th style={{ padding: '8px 0 8px 12px' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {appointments.map((a) => {
                const start = new Date(a.starts_at);
                const s = STATUS_STYLE[a.status] ?? { bg: '#F3F4F6', fg: '#374151', label: a.status };
                return (
                  <tr key={a.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '10px 12px 10px 0', whiteSpace: 'nowrap' }}>
                      <strong>{dayFmt.format(start)}</strong>
                      <span className="text-ink-muted"> · {timeFmt.format(start)}</span>
                    </td>
                    <td style={{ padding: '10px 12px' }}>{patientName(a)}</td>
                    <td style={{ padding: '10px 12px' }} className="text-ink-muted">{a.practice?.name ?? '—'}</td>
                    <td style={{ padding: '10px 12px' }} className="text-ink-muted">{a.associate?.full_name ?? '—'}</td>
                    <td style={{ padding: '10px 0 10px 12px' }}>
                      <span
                        className="font-bold"
                        style={{ background: s.bg, color: s.fg, borderRadius: 999, padding: '3px 10px', fontSize: 11, whiteSpace: 'nowrap' }}
                      >
                        {s.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {!isError && total > 0 && (
          <div
            className="flex items-center justify-between"
            style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)', fontSize: 12 }}
          >
            <span className="text-ink-muted">
              {(() => {
                const start = (page - 1) * PER_PAGE + 1;
                const end = Math.min(page * PER_PAGE, total);
                return `${start.toLocaleString('en-GB')}–${end.toLocaleString('en-GB')} of ${total.toLocaleString('en-GB')}`;
              })()}
            </span>
            <div className="flex items-center" style={{ gap: 8 }}>
              <button
                type="button"
                className="btn-ghost"
                disabled={page <= 1 || isFetching}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                style={{ padding: '4px 12px', fontSize: 12, border: '1px solid var(--border)', opacity: page <= 1 || isFetching ? 0.5 : 1 }}
              >
                Previous
              </button>
              <span className="text-ink-muted">Page {page} of {totalPages.toLocaleString('en-GB')}</span>
              <button
                type="button"
                className="btn-ghost"
                disabled={page >= totalPages || isFetching}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                style={{ padding: '4px 12px', fontSize: 12, border: '1px solid var(--border)', opacity: page >= totalPages || isFetching ? 0.5 : 1 }}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
