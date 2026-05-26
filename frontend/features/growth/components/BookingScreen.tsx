'use client';
// Online Booking — KPI strip + recent-bookings table are Dentally-backed
// (appointments). The booking-source split and widget-settings cards remain
// mock fixtures: Dentally does not record where a booking originated, deposit
// rules, or widget config, so those are not real data yet.
//
// Data flow:
//   useBookingSummary()  ──► KPI strip (today / week / month / no-show rate)
//   useRecentBookings()  ──► recent-bookings table
//   BOOKING_SOURCES      ──► source-split list   (mock — not Dentally)
//   BOOKING_SETTINGS     ──► widget-settings table (mock — config)

import { useState } from 'react';
import { Card, KpiTile, Chip } from '@/components/ui';
import { formatPounds } from '@/features/_mock';
import PracticeTabs from '@/features/practices/PracticeTabs';
import DateRangeFilter, { type DateRange } from '@/features/finance/components/DateRangeFilter';
import { useBookingSummary, useRecentBookings } from '../hooks';
import type { RecentBooking } from '../api';

/** Format an ISO timestamp as a short en-GB date + time. */
function fmtBooking(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Map an appointment status to a chip colour + label. */
function statusChip(status: string): { colour: 'emerald' | 'amber' | 'rose' | 'slate'; label: string } {
  switch (status) {
    case 'completed': return { colour: 'emerald', label: 'Completed' };
    case 'confirmed': return { colour: 'emerald', label: 'Confirmed' };
    case 'no_show': return { colour: 'rose', label: 'No-show' };
    case 'cancelled': return { colour: 'rose', label: 'Cancelled' };
    case 'in_progress': return { colour: 'amber', label: 'In progress' };
    default: return { colour: 'slate', label: 'Scheduled' };
  }
}

const PER_PAGE = 10;

/** Online Booking screen. */
export default function BookingScreen() {
  const [practiceId, setPracticeId] = useState<string | null>(null);
  const [range, setRange] = useState<DateRange>({ from: null, to: null });
  const [page, setPage] = useState(1);
  const { data: summary } = useBookingSummary(practiceId, range);
  const { data: recent, isLoading, isError } = useRecentBookings(practiceId, range, page, PER_PAGE);
  const bookings: RecentBooking[] = recent?.bookings ?? [];
  const total = recent?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  const windowLabel = range.from && range.to ? `${range.from} → ${range.to}` : 'last 30 days';

  // Changing the practice or window resets to page 1 (the old page may not exist).
  const onPractice = (v: string | null) => { setPracticeId(v); setPage(1); };
  const onRange = (r: DateRange) => { setRange(r); setPage(1); };

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-6 flex justify-between items-end">
        <div>
          <h1 className="display text-3xl font-bold">Online Booking</h1>
          <p className="text-sm text-ink-muted mt-1">
            Appointment activity across all practices · {windowLabel}
          </p>
        </div>
        <button className="btn btn-primary">Customise widget</button>
      </div>

      <PracticeTabs value={practiceId} onChange={onPractice} />
      <DateRangeFilter value={range} onChange={onRange} />

      <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <KpiTile label="Today's bookings" value={String(summary?.today ?? 0)} />
        <KpiTile label="This week" value={String(summary?.this_week ?? 0)} />
        <KpiTile label="This month" value={String(summary?.this_month ?? 0)} />
        <KpiTile
          label="No-show rate"
          value={`${summary?.no_show_rate ?? 0}%`}
          delta={`${summary?.no_show_30d ?? 0} of ${summary?.booked_30d ?? 0}`}
          deltaTone={(summary?.no_show_rate ?? 0) > 8 ? 'down' : 'up'}
        />
      </div>

      <Card padded={false}>
        <div
          className="flex justify-between items-center"
          style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}
        >
          <h2 className="display font-semibold" style={{ fontSize: 17 }}>
            Recent bookings
          </h2>
          <span className="text-ink-muted" style={{ fontSize: 12 }}>
            {total.toLocaleString('en-GB')} total
          </span>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-bg border-b border-border">
            <tr>
              <th className="text-left p-3 font-semibold">Date / time</th>
              <th className="text-left p-3 font-semibold">Practice</th>
              <th className="text-left p-3 font-semibold">Patient</th>
              <th className="text-left p-3 font-semibold">Service</th>
              <th className="text-right p-3 font-semibold">Deposit</th>
              <th className="text-left p-3 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {bookings.length === 0 && (
              <tr>
                <td className="p-3 text-ink-muted" colSpan={6}>
                  {isLoading
                    ? 'Loading bookings…'
                    : isError
                    ? 'Could not load bookings. Please try again.'
                    : 'No appointments yet. Connect Dentally to populate this.'}
                </td>
              </tr>
            )}
            {bookings.map((b) => {
              const chip = statusChip(b.status);
              return (
                <tr key={b.id} className="border-b border-border">
                  <td className="p-3 font-semibold">{fmtBooking(b.starts_at)}</td>
                  <td className="p-3 text-ink-muted" style={{ fontSize: 12 }}>
                    {b.practice ?? '—'}
                  </td>
                  <td className="p-3">
                    {b.patient ?? <span className="text-ink-muted">Unknown</span>}
                  </td>
                  <td className="p-3" style={{ fontSize: 12 }}>
                    {b.service ?? '—'}
                  </td>
                  <td className="p-3 text-right">
                    {b.deposit_pence ? (
                      <span className="inline-flex items-center gap-2 justify-end">
                        <span className="font-semibold">{formatPounds(b.deposit_pence / 100)}</span>
                        <Chip colour={b.deposit_paid ? 'emerald' : 'amber'}>
                          {b.deposit_paid ? 'Paid' : 'Due'}
                        </Chip>
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="p-3">
                    <Chip colour={chip.colour}>{chip.label}</Chip>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {total > 0 && (
          <div
            className="flex justify-between items-center"
            style={{ padding: '12px 20px', borderTop: '1px solid var(--border)' }}
          >
            <span className="text-ink-muted" style={{ fontSize: 12 }}>
              Page {page} of {totalPages}
            </span>
            <span className="flex gap-2">
              <button
                type="button"
                className="btn btn-ghost"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </button>
            </span>
          </div>
        )}
      </Card>
    </div>
  );
}
