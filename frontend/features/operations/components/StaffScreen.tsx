'use client';
// Staff Scheduling — pixel-faithful port of preview/elevate-dental-os-v2.html
// (PAGES.staff). Weekly roster, projected labour cost, clock-in compliance.
//
// Data flow:
//   weeklyWage  = sum(scheduled * rate) over all staff
//   monthlyWage = weeklyWage * 4.33   (weeks/month, prototype constant)
//   avgAttend   = mean(attendance)
//
// Fed by ../data STAFF; swap to a real /staff endpoint when it exists.
import { useMemo } from 'react';
import { STAFF, formatPoundsCompact, formatPounds } from '../data';

const POS = '#10B981';

/** Staff Scheduling screen. */
export default function StaffScreen() {
  // Wage projections + average attendance (prototype arithmetic).
  const { weeklyWage, monthlyWage, avgAttend } = useMemo(() => {
    const wk = STAFF.reduce((s, p) => s + p.scheduled * p.rate, 0);
    return {
      weeklyWage: wk,
      monthlyWage: wk * 4.33,
      avgAttend: STAFF.reduce((s, p) => s + p.attendance, 0) / STAFF.length,
    };
  }, []);

  const th: React.CSSProperties = {
    padding: '12px 16px',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: '#6B7280',
    fontWeight: 600,
  };

  return (
    <div className="mx-auto" style={{ maxWidth: 1280 }}>
      {/* Header */}
      <div className="mb-6">
        <div className="flex justify-between items-end">
          <div>
            <h1 className="display font-bold" style={{ fontSize: 28 }}>
              Staff Scheduling
            </h1>
            <p className="text-ink-muted" style={{ fontSize: 13 }}>
              Schedule synced to chair utilisation · projected labour cost ·
              clock-in compliance
            </p>
          </div>
          <button className="btn-primary" style={{ fontSize: 13 }}>
            Open scheduler
          </button>
        </div>
      </div>

      {/* 4 KPIs */}
      <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="card-padded">
          <div className="text-ink-muted font-bold uppercase" style={{ fontSize: 11, letterSpacing: '0.05em' }}>
            Staff scheduled this week
          </div>
          <div className="display font-bold" style={{ fontSize: 28, marginTop: 4 }}>
            {STAFF.length}
          </div>
          <div className="font-bold" style={{ fontSize: 12, marginTop: 4, color: POS }}>
            Across 5 practices
          </div>
        </div>
        <div className="card-padded">
          <div className="text-ink-muted font-bold uppercase" style={{ fontSize: 11, letterSpacing: '0.05em' }}>
            Weekly wage cost
          </div>
          <div className="display font-bold" style={{ fontSize: 28, marginTop: 4 }}>
            {formatPoundsCompact(weeklyWage)}
          </div>
        </div>
        <div className="card-padded">
          <div className="text-ink-muted font-bold uppercase" style={{ fontSize: 11, letterSpacing: '0.05em' }}>
            Monthly projection
          </div>
          <div className="display font-bold" style={{ fontSize: 28, marginTop: 4 }}>
            {formatPoundsCompact(monthlyWage)}
          </div>
          <div className="font-bold" style={{ fontSize: 12, marginTop: 4, color: POS }}>
            17% of revenue
          </div>
        </div>
        <div className="card-padded">
          <div className="text-ink-muted font-bold uppercase" style={{ fontSize: 11, letterSpacing: '0.05em' }}>
            Avg attendance
          </div>
          <div className="display font-bold" style={{ fontSize: 28, marginTop: 4 }}>
            {avgAttend.toFixed(0)}%
          </div>
          <div className="font-bold" style={{ fontSize: 12, marginTop: 4, color: POS }}>
            Last 30 days
          </div>
        </div>
      </div>

      {/* Smart scheduling suggestion */}
      <div className="card-padded mb-4">
        <div style={{ background: 'var(--brand-50)', borderRadius: 8, padding: 14 }}>
          <div className="flex items-center" style={{ gap: 10, marginBottom: 6 }}>
            <strong className="text-brand" style={{ fontSize: 13 }}>
              Smart scheduling suggestion
            </strong>
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.5 }}>
            Tue 9-11am at Warwick Lodge: bookings are 95% but only 1 nurse
            scheduled. Suggest adding Maria for those 2 hours = +£28/wk wage but
            recovers ~£420 lost chair time.
          </div>
        </div>
      </div>

      {/* Roster table */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <table className="w-full" style={{ fontSize: 13 }}>
          <thead className="bg-bg" style={{ borderBottom: '1px solid #E5E7EB' }}>
            <tr>
              <th className="text-left" style={th}>
                Staff member
              </th>
              <th className="text-left" style={th}>
                Role
              </th>
              <th className="text-left" style={th}>
                Practice
              </th>
              {['Hours/wk', 'Rate', 'Weekly cost', 'Attendance'].map((h) => (
                <th key={h} className="text-right" style={th}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {STAFF.map((p) => {
              const chip =
                p.attendance >= 98
                  ? 'chip-emerald'
                  : p.attendance >= 94
                  ? 'chip-brand'
                  : 'chip-amber';
              return (
                <tr key={p.name} style={{ borderBottom: '1px solid #E5E7EB' }}>
                  <td style={{ padding: '12px 16px' }}>
                    <strong>{p.name}</strong>
                  </td>
                  <td className="text-ink-muted" style={{ padding: '12px 16px', fontSize: 12 }}>
                    {p.role}
                  </td>
                  <td className="text-ink-muted" style={{ padding: '12px 16px', fontSize: 12 }}>
                    {p.practice}
                  </td>
                  <td className="text-right" style={{ padding: '12px 16px' }}>
                    {p.scheduled}
                  </td>
                  <td className="text-right" style={{ padding: '12px 16px' }}>
                    £{p.rate}
                  </td>
                  <td className="text-right" style={{ padding: '12px 16px', fontWeight: 600 }}>
                    {formatPounds(p.scheduled * p.rate)}
                  </td>
                  <td className="text-right" style={{ padding: '12px 16px' }}>
                    <span className={`chip ${chip}`}>{p.attendance}%</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
