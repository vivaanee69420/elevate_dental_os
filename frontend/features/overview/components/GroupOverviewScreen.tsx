'use client';

// Group Overview (GM Intelligence OS). Group finances at a glance + a per-entity
// table + a Decision Lens (what to act on this week), computed client-side from
// the real business-hub rollup. Scope-aware: a specific practice narrows the
// view; Academy/Lab note that the hub covers clinical practices.

import { useMemo } from 'react';
import { PageHeader, KpiTile, DataTable, EmptyState, AlertRow, type Column } from '@/components/ui';
import { ScopePeriodBar } from '@/features/_shared/ScopePeriodBar';
import { useScopePeriod } from '@/features/_shared/scope-context';
import { formatPence } from '@/lib/format';
import { useBusinessHub, type HubPractice } from '../business-hub-api';

export function GroupOverviewScreen() {
  const { scope } = useScopePeriod();
  const { data, isLoading, isError } = useBusinessHub();

  // Scope -> the practice rows in view (specific practice narrows; all/practices = every row).
  const inScope: HubPractice[] = useMemo(() => {
    if (!data) return [];
    if (scope === 'all' || scope === 'practices') return data.practices;
    return data.practices.filter((p) => p.practiceId === scope);
  }, [data, scope]);

  // Decision Lens — ranked actions from the data.
  const lens = useMemo(() => buildLens(inScope, data?.group.marginPct ?? 0), [inScope, data]);

  const cols: Column<HubPractice>[] = [
    { header: 'Practice', render: (p) => <span className="font-semibold">{p.name}</span> },
    { header: 'Turnover', align: 'right', render: (p) => formatPence(p.revenuePence) },
    { header: 'Appts', align: 'right', render: (p) => p.appointments.toLocaleString('en-GB') },
    { header: 'No-show', align: 'right', render: (p) => `${p.noShowRate}%` },
    { header: 'Leads', align: 'right', render: (p) => p.leads.toLocaleString('en-GB') },
    { header: 'Conversion', align: 'right', render: (p) => `${p.conversionRate}%` },
  ];

  const headlineRevenue = scope === 'all' || scope === 'practices'
    ? data?.group.revenuePence ?? 0
    : inScope.reduce((s, p) => s + p.revenuePence, 0);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Group Overview"
        subtitle="Group finances at a glance — turnover, margin, demand and conversion across the practices."
      />
      <ScopePeriodBar />

      {isLoading && <EmptyState message="Loading group overview…" />}
      {isError && <AlertRow tone="bad" title="Couldn't load the overview" />}

      {data && (scope === 'academy' || scope === 'lab') && (
        <AlertRow tone="info" title="The Business Hub covers clinical practices"
          body="Academy and Lab roll into the P&L and Valuation views — switch scope to the group or a practice here." />
      )}

      {data && scope !== 'academy' && scope !== 'lab' && (
        <>
          <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
            <KpiTile label="Turnover" value={formatPence(headlineRevenue)} delta={`${data.period.days}-day window`} />
            <KpiTile label="Margin" value={`${data.group.marginPct}%`} delta="net, from actuals" deltaTone={data.group.marginPct >= 18 ? 'up' : data.group.marginPct > 0 ? 'muted' : 'down'} />
            <KpiTile label="Appointments" value={inScopeSum(inScope, 'appointments').toLocaleString('en-GB')} delta={`${inScopeSum(inScope, 'completed').toLocaleString('en-GB')} completed`} />
            <KpiTile label="No-show rate" value={`${rate(inScopeSum(inScope, 'noShows'), inScopeSum(inScope, 'appointments'))}%`} delta={`${inScopeSum(inScope, 'noShows').toLocaleString('en-GB')} no-shows`} deltaTone="down" />
            <KpiTile label="Leads" value={inScopeSum(inScope, 'leads').toLocaleString('en-GB')} delta="in window" />
            <KpiTile label="Conversion" value={`${rate(convertedFrom(inScope), inScopeSum(inScope, 'leads'))}%`} delta="lead → patient" deltaTone="up" />
          </div>

          <div className="grid gap-4 md:grid-cols-2 items-start">
            <div>
              <h3 className="display text-lg mb-2">Business performance — by practice</h3>
              <DataTable columns={cols} rows={inScope} rowKey={(p) => p.practiceId} empty={<EmptyState message="No practices in scope." />} />
            </div>
            <div className="card-padded">
              <h3 className="display text-lg mb-3">Decision Lens — what to act on this week</h3>
              {lens.length === 0 ? (
                <p className="text-sm text-ink-muted">No standout actions in scope.</p>
              ) : (
                lens.map((a, i) => <AlertRow key={i} tone={a.tone} title={a.title} body={a.body} />)
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function inScopeSum(rows: HubPractice[], k: keyof HubPractice): number {
  return rows.reduce((s, p) => s + (Number(p[k]) || 0), 0);
}
function convertedFrom(rows: HubPractice[]): number {
  return rows.reduce((s, p) => s + Math.round((p.leads * p.conversionRate) / 100), 0);
}
function rate(n: number, d: number): number {
  return d ? Math.round((n / d) * 1000) / 10 : 0;
}

type Lens = { tone: 'good' | 'warn' | 'bad' | 'info'; title: string; body: string };
function buildLens(rows: HubPractice[], marginPct: number): Lens[] {
  if (!rows.length) return [];
  const out: Lens[] = [];
  const topRev = [...rows].sort((a, b) => b.revenuePence - a.revenuePence)[0];
  out.push({ tone: 'good', title: `${topRev.name} leads on turnover`, body: `${formatPence(topRev.revenuePence)} in the window — protect its diary and replicate the mix.` });

  const worstNoShow = [...rows].filter((p) => p.appointments > 0).sort((a, b) => b.noShowRate - a.noShowRate)[0];
  if (worstNoShow && worstNoShow.noShowRate > 0)
    out.push({ tone: 'warn', title: `${worstNoShow.name} no-show rate ${worstNoShow.noShowRate}%`, body: `${worstNoShow.noShows.toLocaleString('en-GB')} missed appointments — reminders, deposits and speed-to-lead are the cheapest fix.` });

  const worstConv = [...rows].filter((p) => p.leads > 0).sort((a, b) => a.conversionRate - b.conversionRate)[0];
  if (worstConv)
    out.push({ tone: 'info', title: `${worstConv.name} converts ${worstConv.conversionRate}% of leads`, body: `Front-desk conversion is the lever — a few points here beats more ad spend.` });

  out.push({ tone: marginPct >= 18 ? 'good' : 'bad', title: `Group net margin ${marginPct}%`, body: marginPct >= 18 ? 'Healthy against the ~18% dental benchmark.' : 'Below the ~18% benchmark — wage ratio and lab/materials are the usual leak.' });
  return out.slice(0, 4);
}
