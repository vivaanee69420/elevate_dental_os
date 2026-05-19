'use client';
// Online Booking — pixel-faithful port of
// preview/elevate-dental-os-v2.html (PAGES.booking). 4-up KPI strip,
// booking-source split, widget-settings table, and a recent-bookings
// table. Fed by the growth mock-data layer; swap to a real booking-widget
// endpoint when one exists server-side. Prototype emoji on the action
// button and brand-swatch row are dropped per project rule 7.
//
// Data flow:
//   BOOKING_TOTALS ──► KPI strip
//   BOOKING_SOURCES ──► source-split list
//   BOOKING_SETTINGS ──► widget-settings table
//   BOOKINGS ──► recent-bookings table (date formatted en-GB)

import { Card, KpiTile, Chip } from '@/components/ui';
import { formatPounds } from '@/features/_mock';
import {
  BOOKINGS,
  BOOKING_TOTALS,
  BOOKING_SOURCES,
  BOOKING_SETTINGS,
} from '../data';

/** Format a "YYYY-MM-DD HH:MM" string as a short en-GB date + time. */
function fmtBooking(date: string): string {
  return new Date(date).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Online Booking screen. */
export default function BookingScreen() {
  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-6 flex justify-between items-end">
        <div>
          <h1 className="display text-3xl font-bold">Online Booking</h1>
          <p className="text-sm text-ink-muted mt-1">
            Patients book directly · zero commission · brand-matched
          </p>
        </div>
        <button className="btn btn-primary">Customise widget</button>
      </div>

      <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <KpiTile label="Today's bookings" value={String(BOOKING_TOTALS.today)} />
        <KpiTile
          label="This week"
          value={String(BOOKING_TOTALS.week)}
          delta="+18% vs last week"
          deltaTone="up"
        />
        <KpiTile label="This month" value={String(BOOKING_TOTALS.month)} />
        <KpiTile
          label="Online share"
          value={`${BOOKING_TOTALS.onlineSharePct}%`}
          delta="vs phone"
          deltaTone="up"
        />
      </div>

      <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Card>
          <h2 className="display font-semibold mb-3" style={{ fontSize: 17 }}>
            Booking sources (last 30 days)
          </h2>
          {BOOKING_SOURCES.map((s, i) => (
            <div
              key={s.source}
              className="flex justify-between items-center text-sm"
              style={{
                padding: '8px 0',
                borderBottom:
                  i < BOOKING_SOURCES.length - 1 ? '1px solid var(--border)' : 'none',
              }}
            >
              <strong>{s.source}</strong>
              <div className="text-right">
                <span className="font-semibold">{s.count}</span>{' '}
                <span className="text-ink-muted" style={{ fontSize: 11 }}>
                  ({s.pct}%)
                </span>
              </div>
            </div>
          ))}
        </Card>

        <Card>
          <h2 className="display font-semibold mb-3" style={{ fontSize: 17 }}>
            Booking widget settings
          </h2>
          <table className="w-full text-sm">
            <tbody>
              {BOOKING_SETTINGS.map((row) => (
                <tr key={row.label}>
                  <td className="text-ink-muted" style={{ padding: '8px 0' }}>
                    {row.label}
                  </td>
                  <td className="text-right" style={{ padding: '8px 0' }}>
                    {row.value}
                  </td>
                </tr>
              ))}
              <tr>
                <td className="text-ink-muted" style={{ padding: '8px 0' }}>
                  Brand colour match
                </td>
                <td className="text-right" style={{ padding: '8px 0' }}>
                  <span
                    style={{
                      display: 'inline-block',
                      width: 16,
                      height: 16,
                      background: '#0E7C7B',
                      borderRadius: 4,
                      verticalAlign: 'middle',
                    }}
                  />{' '}
                  GM Teal
                </td>
              </tr>
              <tr>
                <td className="text-ink-muted" style={{ padding: '8px 0' }}>
                  Auto-confirm email/SMS
                </td>
                <td className="text-right" style={{ padding: '8px 0' }}>
                  <Chip colour="emerald">Enabled</Chip>
                </td>
              </tr>
            </tbody>
          </table>
        </Card>
      </div>

      <Card padded={false}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
          <h2 className="display font-semibold" style={{ fontSize: 17 }}>
            Recent bookings
          </h2>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-bg border-b border-border">
            <tr>
              <th className="text-left p-3 font-semibold">Date / time</th>
              <th className="text-left p-3 font-semibold">Practice</th>
              <th className="text-left p-3 font-semibold">Patient</th>
              <th className="text-left p-3 font-semibold">Service</th>
              <th className="text-left p-3 font-semibold">Source</th>
              <th className="text-right p-3 font-semibold">Deposit</th>
              <th className="text-left p-3 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {BOOKINGS.map((b, i) => (
              <tr key={`${b.date}-${i}`} className="border-b border-border">
                <td className="p-3 font-semibold">{fmtBooking(b.date)}</td>
                <td className="p-3 text-ink-muted" style={{ fontSize: 12 }}>
                  {b.practice}
                </td>
                <td className="p-3">{b.patient}</td>
                <td className="p-3" style={{ fontSize: 12 }}>
                  {b.service}
                </td>
                <td className="p-3">
                  <Chip colour="purple">{b.source}</Chip>
                </td>
                <td className="p-3 text-right font-semibold">
                  {b.deposit ? formatPounds(b.deposit) : '—'}
                </td>
                <td className="p-3">
                  <Chip colour={b.status === 'Confirmed' ? 'emerald' : 'amber'}>
                    {b.status}
                  </Chip>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
