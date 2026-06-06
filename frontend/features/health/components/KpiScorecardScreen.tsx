'use client';
// KPI Scorecard — 23-metric traffic-lighted dashboard, live from /api/health/metrics.
// Auto metrics show a source chip; manual metrics show an owner-only inline edit.
// British English, no emojis (rule 7), £ via formatPounds, no fabricated numbers.

import { useState } from 'react';
import { formatPounds } from '@/features/_mock';
import { useMe } from '@/hooks/useMe';
import { SkeletonKpiRow, SkeletonTable } from '@/components/ui';
import { useMetrics, useUpdateMetric } from '../hooks';
import type { HealthMetric } from '../api';

type Status = 'green' | 'amber' | 'red';
const STATUS_COLOUR: Record<Status, string> = { green: 'var(--success)', amber: 'var(--warning)', red: 'var(--danger)' };
const CATEGORIES = ['Financial', 'Patient', 'Conversion', 'Operational'] as const;

function statusOf(m: HealthMetric): Status {
  if (m.current == null || m.target == null) return 'amber';
  if (m.better === 'higher') {
    if (m.current >= m.target) return 'green';
    if (m.current >= m.target * 0.9) return 'amber';
    return 'red';
  }
  if (m.current <= m.target) return 'green';
  if (m.current <= m.target * 1.1) return 'amber';
  return 'red';
}

function fmt(n: number | null, unit: HealthMetric['unit']): string {
  if (n == null) return '—';
  if (unit === '£') return formatPounds(n);
  if (unit === '%') return n + '%';
  if (unit === 'min') return n + 'm';
  return n.toLocaleString('en-GB');
}

function progressPct(m: HealthMetric): number {
  if (m.current == null || m.target == null || m.target === 0 || m.current === 0) return 0;
  const raw = m.better === 'higher' ? (m.current / m.target) * 100 : (m.target / m.current) * 100;
  return Math.min(100, Math.max(0, raw));
}

function MetricCard({ m, canEdit }: { m: HealthMetric; canEdit: boolean }) {
  const st = statusOf(m);
  const update = useUpdateMetric();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState('');
  const editable = canEdit && m.sourceType === 'manual';

  return (
    <div className="bg-bg" style={{ borderLeft: `4px solid ${STATUS_COLOUR[st]}`, padding: '10px 12px', borderRadius: '0 6px 6px 0' }}>
      <div className="flex justify-between items-center mb-0.5">
        <div className="text-[11px] text-ink-muted">{m.label}</div>
        <span className="text-[9px] uppercase tracking-wide text-ink-muted">
          {m.sourceType === 'auto' ? m.source : m.needsInput ? 'no data' : `manual${m.asof ? ` · ${m.asof}` : ''}`}
        </span>
      </div>
      <div className="flex justify-between items-baseline">
        <div className="display text-xl font-bold">{m.needsInput ? '—' : fmt(m.current, m.unit)}</div>
        <div className="text-[11px] text-ink-muted">Target: {fmt(m.target, m.unit)}</div>
      </div>
      <div className="mt-1.5 overflow-hidden" style={{ height: 4, background: 'rgba(0,0,0,0.05)', borderRadius: 2 }}>
        <div style={{ height: '100%', width: `${progressPct(m)}%`, background: STATUS_COLOUR[st] }} />
      </div>
      {editable && !editing && (
        <button className="text-[10px] text-brand mt-1.5" onClick={() => { setEditing(true); setVal(m.current?.toString() ?? ''); }}>
          {m.needsInput ? 'Enter value' : 'Edit'}
        </button>
      )}
      {editable && editing && (
        <div className="flex gap-1 mt-1.5">
          <input
            type="number" value={val} onChange={(e) => setVal(e.target.value)}
            className="border border-border rounded px-1.5 py-0.5 text-xs w-20"
            aria-label={`Set ${m.label}`}
          />
          <button
            className="text-[10px] text-white bg-brand rounded px-2"
            disabled={update.isPending || val === ''}
            onClick={() => update.mutate({ key: m.key, value: Number(val) }, { onSuccess: () => setEditing(false) })}
          >Save</button>
          <button className="text-[10px] text-ink-muted px-1" onClick={() => setEditing(false)}>Cancel</button>
        </div>
      )}
    </div>
  );
}

function SummaryTile({ label, value, colour }: { label: string; value: number; colour?: string }) {
  return (
    <div className="card-padded">
      <div className="text-xs text-ink-muted uppercase">{label}</div>
      <div className="display text-2xl font-bold mt-1" style={colour ? { color: colour } : undefined}>{value}</div>
    </div>
  );
}

// Month picker value 'YYYY-MM' -> last day of that month 'YYYY-MM-DD' (period end).
function monthToAsOf(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return `${month}-${String(last).padStart(2, '0')}`;
}

export default function KpiScorecardScreen() {
  const [month, setMonth] = useState('');           // '' = live current values
  const asOf = month ? monthToAsOf(month) : undefined;
  const { data } = useMetrics(asOf);
  const { data: me } = useMe();
  // Viewing a past period is read-only — you cannot edit history.
  const canEdit = me?.role === 'owner' && !asOf;

  if (!data)
    return (
      <div className="flex flex-col gap-4">
        <SkeletonKpiRow count={4} />
        <SkeletonTable rows={8} cols={4} />
      </div>
    );
  const metrics = data.metrics;
  const green = metrics.filter((m) => statusOf(m) === 'green').length;
  const amber = metrics.filter((m) => statusOf(m) === 'amber').length;
  const red = metrics.filter((m) => statusOf(m) === 'red').length;

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-4 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="display text-3xl font-bold">KPI Scorecard</h1>
          <p className="text-sm text-ink-muted">
            Performance management · {metrics.length} KPIs traffic-lighted ·{' '}
            {asOf ? `showing values as at ${asOf} (read-only history)` : 'live from your connected data'}
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink-muted">
          As at
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="border border-line rounded-md px-2 py-1 text-ink"
          />
          {month && (
            <button type="button" onClick={() => setMonth('')} className="text-accent underline">
              Live
            </button>
          )}
        </label>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <SummaryTile label="Total KPIs tracked" value={metrics.length} />
        <SummaryTile label="On / above target" value={green} colour="var(--success)" />
        <SummaryTile label="Watching" value={amber} colour="var(--accent)" />
        <SummaryTile label="Below target" value={red} colour="var(--danger)" />
      </div>

      {CATEGORIES.map((cat) => {
        const items = metrics.filter((m) => m.cat === cat);
        if (!items.length) return null;
        return (
          <div key={cat} className="card card-padded mb-3.5">
            <h2 className="display text-[17px] font-semibold mb-3.5">{cat} KPIs</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
              {items.map((m) => <MetricCard key={m.key} m={m} canEdit={canEdit} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
