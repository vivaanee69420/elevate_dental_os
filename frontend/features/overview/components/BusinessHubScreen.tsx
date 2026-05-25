'use client';
// Business Hub — the "overview of the whole business": group totals + a
// per-practice comparison, computed server-side from real data (settled
// payments, appointments, leads) joined against the business_health baseline.
//
// Source: GET /api/analytics/business-hub (see analytics.service.businessHub).
// Numbers are zero until data is fed (Dentally/CSV → payments/appointments,
// GoHighLevel → leads). Group revenue target comes from the org baseline.

import { useState } from 'react';
import { Card, Chip } from '@/components/ui';
import { formatPence, formatNumber } from '@/lib/format';
import { useBusinessHub, type HubPractice } from '../business-hub-api';
import PracticeTabs from '@/features/practices/PracticeTabs';

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'good' | 'warn' | 'bad' }) {
  const colour = tone === 'good' ? 'var(--success)' : tone === 'warn' ? 'var(--warning)' : tone === 'bad' ? 'var(--danger)' : undefined;
  return (
    <div className="card-padded">
      <div className="text-xs text-ink-muted uppercase">{label}</div>
      <div className="display text-2xl font-bold mt-1" style={colour ? { color: colour } : undefined}>{value}</div>
      {sub && <div className="text-xs text-ink-muted mt-1">{sub}</div>}
    </div>
  );
}

// Red when a practice's no-show rate is high; green when conversion is strong.
function rateChip(value: number, kind: 'noShow' | 'conversion') {
  if (kind === 'noShow') {
    if (value >= 15) return <Chip colour="rose">{value}%</Chip>;
    if (value >= 8) return <Chip colour="amber">{value}%</Chip>;
    return <Chip colour="emerald">{value}%</Chip>;
  }
  if (value >= 50) return <Chip colour="emerald">{value}%</Chip>;
  if (value >= 30) return <Chip colour="amber">{value}%</Chip>;
  return <Chip colour="rose">{value}%</Chip>;
}

export default function BusinessHubScreen() {
  const { data, isLoading, error } = useBusinessHub(90);
  const [practiceId, setPracticeId] = useState<string | null>(null);

  if (isLoading) {
    return <div className="container mx-auto text-ink-muted" style={{ maxWidth: 1400 }}>Loading business overview…</div>;
  }
  if (error) {
    return (
      <div className="container mx-auto" style={{ maxWidth: 1400 }}>
        <div style={{ color: 'var(--danger)', fontSize: 13 }}>Failed to load: {(error as Error).message}</div>
      </div>
    );
  }
  const g = data!.group;
  const practices = data!.practices;
  // When a practice tab is active, the headline strip reflects that practice's
  // rollup row; "All practices" shows group totals (unchanged). Target + group
  // margin are group-only (no per-practice baseline source).
  const selected = practiceId ? practices.find((p) => p.practiceId === practiceId) ?? null : null;
  const view = selected ?? g;
  const targetDelta = g.revenueTargetPence ? g.revenuePence - g.revenueTargetPence : 0;
  const hasData = g.revenuePence > 0 || g.appointments > 0 || g.leads > 0;

  return (
    <div className="container mx-auto" style={{ maxWidth: 1400 }}>
      <div className="mb-6">
        <h1 className="display text-3xl font-bold">Business Hub</h1>
        <p className="text-sm text-ink-muted mt-1">
          Group totals and per-practice comparison &middot; last {data!.period.days} days &middot; {g.practices} sites
        </p>
      </div>

      <PracticeTabs value={practiceId} onChange={setPracticeId} />

      {!hasData && (
        <Card className="mb-4">
          <div className="text-sm text-ink-muted">
            No revenue, appointments or leads yet for this period. Connect Dentally/GoHighLevel or import a CSV
            via <strong>Data Hub</strong>, and these totals fill in automatically.
          </div>
        </Card>
      )}

      {/* Group KPI strip */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 16 }}>
        <Kpi
          label={selected ? 'Practice revenue' : 'Group revenue'}
          value={formatPence(view.revenuePence)}
          sub={selected
            ? selected.name
            : g.revenueTargetPence
              ? `${targetDelta >= 0 ? '+' : ''}${formatPence(targetDelta)} vs target`
              : 'no target set'}
          tone={selected ? undefined : g.revenueTargetPence ? (targetDelta >= 0 ? 'good' : 'warn') : undefined}
        />
        <Kpi
          label="Group margin (baseline)"
          value={selected ? '—' : `${g.marginPct}%`}
          sub={selected ? 'group-level only' : 'from Business Health'}
        />
        <Kpi
          label="Appointments"
          value={formatNumber(view.appointments)}
          sub={`${view.noShowRate}% no-show`}
          tone={view.noShowRate >= 15 ? 'bad' : view.noShowRate >= 8 ? 'warn' : 'good'}
        />
        <Kpi
          label="Lead conversion"
          value={`${view.conversionRate}%`}
          sub={`${formatNumber(view.leads)} leads`}
          tone={view.conversionRate >= 50 ? 'good' : view.conversionRate >= 30 ? 'warn' : 'bad'}
        />
      </div>

      {/* Per-practice comparison */}
      <Card>
        <h2 className="display font-semibold" style={{ fontSize: 17, marginBottom: 12 }}>Practice comparison</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Practice</th>
              <th className="right">Revenue</th>
              <th className="right">Chairs</th>
              <th className="right">Appts</th>
              <th>No-show</th>
              <th className="right">Leads</th>
              <th>Conversion</th>
            </tr>
          </thead>
          <tbody>
            {practices.map((p: HubPractice) => (
              <tr key={p.practiceId}>
                <td><strong>{p.name}</strong></td>
                <td className="right">{formatPence(p.revenuePence)}</td>
                <td className="right">{p.chairs}</td>
                <td className="right">{formatNumber(p.appointments)}</td>
                <td>{rateChip(p.noShowRate, 'noShow')}</td>
                <td className="right">{formatNumber(p.leads)}</td>
                <td>{rateChip(p.conversionRate, 'conversion')}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data!.truncated && (
          <div className="text-xs text-ink-muted mt-2">Showing a capped sample — totals may be partial.</div>
        )}
      </Card>
    </div>
  );
}
