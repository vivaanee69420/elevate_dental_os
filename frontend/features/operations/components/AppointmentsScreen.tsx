'use client';
// Appointments (Operations) — upcoming, open appointments pulled from the live
// Dentally sync. Unlike the other Operations screens this is REAL data: it hits
// GET /api/appointments?from=<today> (backend orders by starts_at asc), so it
// shows the same open appointments the first Dentally pull brings in.

import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Skeleton } from '@/components/ui';
import { api } from '@/lib/api';

const PER_PAGE = 25;

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
  // Midnight today, so an appointment earlier today still shows.
  const from = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }, []);
  const [page, setPage] = useState(1);

  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey: ['appointments', 'upcoming', from, page],
    queryFn: () =>
      api<AppointmentsResponse>(
        `/api/appointments?from=${encodeURIComponent(from)}&page=${page}&per_page=${PER_PAGE}`,
      ),
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
          Upcoming, open appointments across your practices · live from Dentally
        </p>
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
            No upcoming appointments. They appear here once a Dentally sync has run.
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
