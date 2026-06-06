'use client';
// Staff — team roster, live from Dentally `/users`. Dentally carries no HR data
// (hourly rate, weekly hours, scheduled hours, attendance), so this is an
// identity/role/practice directory, not a wage/rota view. Source: /api/staff.

import { useState } from 'react';
import PracticeTabs from '@/features/practices/PracticeTabs';
import { useStaff, type StaffRow } from '../staff-api';
import { SkeletonKpiRow, SkeletonTable } from '@/components/ui';

/** Format a last-login timestamp as a short en-GB date (or em dash). */
function fmtLastActive(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Staff roster screen — sourced from /api/staff. */
export default function StaffScreen() {
  // Practice filter is dynamic: PracticeTabs builds from /api/practices, which
  // is the org's Dentally-site-derived practice list (auto-hidden if ≤1).
  const [practiceId, setPracticeId] = useState<string | null>(null);
  const { data, isLoading, isError, error } = useStaff(practiceId ?? undefined);
  const staff: StaffRow[] = data?.staff ?? [];

  const th: React.CSSProperties = {
    padding: '12px 16px',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: 'var(--ink-muted)',
    fontWeight: 600,
  };

  const kpi = (label: string, value: string | number) => (
    <div className="card-padded">
      <div className="text-ink-muted font-bold uppercase" style={{ fontSize: 11, letterSpacing: '0.05em' }}>
        {label}
      </div>
      <div className="display font-bold" style={{ fontSize: 28, marginTop: 4 }}>
        {value}
      </div>
    </div>
  );

  return (
    <div className="mx-auto" style={{ maxWidth: 1280 }}>
      {/* Header */}
      <div className="mb-6">
        <h1 className="display font-bold" style={{ fontSize: 28 }}>
          Staff
        </h1>
        <p className="text-ink-muted" style={{ fontSize: 13 }}>
          Practice team roster · live from Dentally
        </p>
      </div>

      {/* Dynamic practice filter — tabs come from the org's Dentally sites. */}
      <PracticeTabs value={practiceId} onChange={setPracticeId} />

      {isLoading && (
        <>
          <SkeletonKpiRow count={4} className="mb-4" />
          <SkeletonTable rows={6} cols={4} />
        </>
      )}

      {isError && (
        <div className="card-padded" style={{ fontSize: 13, color: 'var(--danger)' }}>
          Could not load staff: {(error as Error)?.message ?? 'unknown error'}
        </div>
      )}

      {!isLoading && !isError && (
        <>
          {/* 4 KPIs */}
          <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            {kpi('Total staff', data?.total_staff ?? 0)}
            {kpi('Roles', data?.distinct_roles ?? 0)}
            {kpi('Practices covered', data?.practices_covered ?? 0)}
            {kpi('Active (90 days)', data?.active_count ?? 0)}
          </div>

          {/* Roster table */}
          <div className="card" style={{ overflow: 'hidden' }}>
            {staff.length === 0 ? (
              <p className="text-ink-muted" style={{ fontSize: 13, padding: '16px 20px' }}>
                No staff synced yet. Connect Dentally and run a sync to populate this.
              </p>
            ) : (
              <table className="w-full" style={{ fontSize: 13 }}>
                <thead className="bg-bg" style={{ borderBottom: '1px solid var(--border)' }}>
                  <tr>
                    <th className="text-left" style={th}>Staff member</th>
                    <th className="text-left" style={th}>Role</th>
                    <th className="text-left" style={th}>Practice</th>
                    <th className="text-left" style={th}>Email</th>
                    <th className="text-left" style={th}>Phone</th>
                    <th className="text-right" style={th}>Last active</th>
                  </tr>
                </thead>
                <tbody>
                  {staff.map((p) => (
                    <tr key={p.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '12px 16px' }}>
                        <strong>{p.full_name}</strong>
                      </td>
                      <td className="text-ink-muted" style={{ padding: '12px 16px', fontSize: 12 }}>
                        {p.role ?? '—'}
                      </td>
                      <td className="text-ink-muted" style={{ padding: '12px 16px', fontSize: 12 }}>
                        {p.practice ?? '—'}
                      </td>
                      <td className="text-ink-muted" style={{ padding: '12px 16px', fontSize: 12 }}>
                        {p.email ?? '—'}
                      </td>
                      <td className="text-ink-muted" style={{ padding: '12px 16px', fontSize: 12 }}>
                        {p.phone ?? '—'}
                      </td>
                      <td className="text-right" style={{ padding: '12px 16px' }}>
                        {p.recently_active ? (
                          <span className="chip chip-emerald">{fmtLastActive(p.last_login_at)}</span>
                        ) : (
                          fmtLastActive(p.last_login_at)
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
