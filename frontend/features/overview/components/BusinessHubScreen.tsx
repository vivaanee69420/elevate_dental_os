'use client';
// Business Hub — the "overview of the whole business": group totals + a
// per-practice comparison, computed server-side from real data (settled
// payments, appointments, leads) joined against the business_health baseline.
//
// Source: GET /api/analytics/business-hub (see analytics.service.businessHub).
// Numbers are zero until data is fed (Dentally/CSV → payments/appointments,
// GoHighLevel → leads). Group revenue target comes from the org baseline.

import { useState } from 'react';
import { Card, Chip, SkeletonKpiRow, SkeletonChart, Skeleton } from '@/components/ui';
import { formatPence, formatNumber } from '@/lib/format';
import { useBusinessHub, type HubPractice } from '../business-hub-api';
import { useMarketingRoi } from '@/features/growth/hooks';
import { useScopePeriod } from '@/features/_shared/scope-context';
import PracticeTabs from '@/features/practices/PracticeTabs';

// A rate the data cannot support is an em dash, never a confident 0%. The
// backend returns null for exactly that case (no denominator, or a metric the
// tenant's PMS has never synced); rendering it as 0 turned "we don't know" into
// "excellent" for no-show and into "terrible" for conversion.
function pct(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${value}%`;
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'good' | 'warn' | 'bad' }) {
  const colour = tone === 'good' ? 'var(--success)' : tone === 'warn' ? 'var(--warning)' : tone === 'bad' ? 'var(--danger)' : undefined;
  return (
    <div className="card-padded">
      <div className="text-xs text-ink-muted uppercase">{label}</div>
      <div className="text-2xl font-bold mt-1" style={colour ? { color: colour } : undefined}>{value}</div>
      {sub && <div className="text-xs text-ink-muted mt-1">{sub}</div>}
    </div>
  );
}

// Red when a practice's no-show rate is high; green when conversion is strong.
function rateChip(value: number | null, kind: 'noShow' | 'conversion') {
  // Unknowable: no chip colour at all. A grey em dash cannot be misread as a
  // grade the way a green or red 0% can.
  if (value === null) return <span className="text-ink-muted">—</span>;
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
  // Follow the global Scope/Period filter (month/day) like the Group Overview +
  // Performance screens above. Previously pinned to a fixed 90-day window, which
  // made this block disagree with the rest of the page (e.g. page on "Mar 2026"
  // but this still showing trailing 90 days).
  const { data, isLoading, error } = useBusinessHub();
  const [practiceId, setPracticeId] = useState<string | null>(null);
  // SCOPED. useMarketingRoi() was called with no arguments, so these cards stayed
  // group-wide over the backend's own default window while the user had a
  // practice selected and a period picked — and they were labelled "(30d)",
  // which was not that default either. They now follow the same practice tab and
  // the same period as every other figure on the page.
  const { win } = useScopePeriod();
  const { data: roi } = useMarketingRoi(practiceId, { from: win.since, to: win.until });

  if (isLoading) {
    return (
      <div>
        <div className="mb-6">
          <Skeleton className="h-8 w-56 mb-2" />
          <Skeleton className="h-4 w-80" />
        </div>
        <SkeletonKpiRow count={4} className="mb-6" />
        <SkeletonChart height={300} />
      </div>
    );
  }
  if (error) {
    return (
      <div>
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
  // Two different empty states that used to render as one. "Nothing at all" means
  // no source is connected and the fix is Integrations; "nothing in this window"
  // means the tenant has data, just not here, and the fix is the period picker.
  // Telling a brand-new org that its quiet month is the problem sent it looking
  // in the wrong place.
  const hasWindowData = g.revenuePence > 0 || g.appointments > 0 || g.leads > 0;
  const hasAnyPractices = practices.length > 0;

  return (
    <div>
      <div className="mb-6">
        <h1 className="display text-3xl font-bold">Business Hub</h1>
        <p className="text-sm text-ink-muted mt-1">
          Group totals and per-practice comparison &middot; {data!.period.label ?? `last ${data!.period.days} days`} &middot; {g.practices} sites
        </p>
      </div>

      <PracticeTabs value={practiceId} onChange={setPracticeId} />

      {!hasWindowData && (
        <Card className="mb-4">
          <div className="text-sm text-ink-muted">
            {hasAnyPractices ? (
              <>
                No revenue, appointments or leads fell in <strong>{data!.period.label ?? 'this period'}</strong>.
                Try a different period, or check the feed dates on <strong>Integrations</strong>.
              </>
            ) : (
              <>
                Nothing is connected yet. Connect Dentally or GoHighLevel, or import a CSV via{' '}
                <strong>Data Hub</strong>, and these totals fill in automatically.
              </>
            )}
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
              ? `${targetDelta >= 0 ? '+' : ''}${formatPence(targetDelta)} vs target (${formatPence(g.revenueTargetAnnualPence)}/yr pro-rated)`
              : 'no target set'}
          tone={selected ? undefined : g.revenueTargetPence ? (targetDelta >= 0 ? 'good' : 'warn') : undefined}
        />
        <Kpi
          label="Group margin"
          value={selected ? '—' : g.marginPct ? `${g.marginPct}%` : '—'}
          sub={selected ? 'group-level only' : g.marginPct ? 'P&L actuals, last 12 months' : 'no cost data'}
        />
        <Kpi
          label="Appointments"
          value={formatNumber(view.appointments)}
          sub={g.noShowTracked ? `${pct(view.noShowRate)} no-show` : 'no-show not tracked'}
          tone={view.noShowRate === null ? undefined
            : view.noShowRate >= 15 ? 'bad' : view.noShowRate >= 8 ? 'warn' : 'good'}
        />
        <Kpi
          label="Lead conversion"
          value={pct(view.conversionRate)}
          sub={selected
            ? `${formatNumber(view.leads)} CRM leads`
            : `${formatNumber(g.leads)} leads, all sources`}
          tone={view.conversionRate === null ? undefined
            : view.conversionRate >= 50 ? 'good' : view.conversionRate >= 30 ? 'warn' : 'bad'}
        />
      </div>

      {/* Marketing ROI strip — paid ads (Google Ads now; Meta next), last 30
          days. Account-level (not per-practice), so it stays on group view. */}
      {!selected && roi?.connected && (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 16 }}>
          <Kpi label="Ad spend" value={formatPence(roi.spend_pence)} sub={`${formatNumber(roi.clicks)} clicks · ${data!.period.label ?? 'window'}`} />
          <Kpi
            label="ROAS"
            value={roi.roas ? `${roi.roas.toFixed(2)}x` : '—'}
            sub="settled revenue / spend"
            tone={!roi.roas ? undefined : roi.roas >= 4 ? 'good' : roi.roas >= 1 ? 'warn' : 'bad'}
          />
          <Kpi label="Cost / new patient" value={roi.cac_pence ? formatPence(roi.cac_pence) : '—'} sub={`${formatNumber(roi.new_patients)} new patients`} />
          <Kpi label="Cost / lead" value={roi.cpl_pence ? formatPence(roi.cpl_pence) : '—'} sub={`${formatNumber(roi.leads_from_ads)} ad leads`} />
        </div>
      )}

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
              <th className="right">No-show</th>
              <th className="right">Leads (CRM)</th>
              <th className="right">Conversion</th>
            </tr>
          </thead>
          <tbody>
            {practices.map((p: HubPractice) => (
              <tr key={p.practiceId}>
                <td><strong>{p.name}</strong></td>
                <td className="right">{formatPence(p.revenuePence)}</td>
                <td className="right">{p.chairs}</td>
                <td className="right">{formatNumber(p.appointments)}</td>
                <td className="right">{rateChip(p.noShowRate, 'noShow')}</td>
                <td className="right">{formatNumber(p.leads)}</td>
                <td className="right">{rateChip(p.conversionRate, 'conversion')}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {g.leads > g.leadsCrm && (
          <div className="text-xs text-ink-muted mt-2">
            Per-practice leads are CRM enquiries only ({formatNumber(g.leadsCrm)}). The{' '}
            {formatNumber(g.leads - g.leadsCrm)} ad-platform leads in the headline have no reliable
            practice attribution — one ad account usually serves the whole group — so they are
            counted at group level and not split across these rows.
          </div>
        )}
        {data!.truncated && (
          <div className="text-xs text-ink-muted mt-2">Showing a capped sample — totals may be partial.</div>
        )}
      </Card>
    </div>
  );
}
