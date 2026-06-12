'use client';

// Group Overview (GM Intelligence OS). Group finances at a glance + a per-entity
// table + a Decision Lens (what to act on this week), computed client-side from
// the real business-hub rollup. Scope-aware: a specific practice narrows the
// view; Academy/Lab note that the hub covers clinical practices.

import { useMemo } from 'react';
import { PageHeader, KpiTile, EmptyState, AlertRow } from '@/components/ui';
import { ScopePeriodBar } from '@/features/_shared/ScopePeriodBar';
import { useScopePeriod } from '@/features/_shared/scope-context';
import { formatPence } from '@/lib/format';
import { useBusinessHub, type HubPractice } from '../business-hub-api';
import { GhlSummaryCards } from '@/features/ghl/components/GhlSummaryCards';

export function GroupOverviewScreen() {
  const { scope } = useScopePeriod();
  const { data, isLoading, isError } = useBusinessHub();

  // Scope -> the practice rows in view (specific practice narrows; all/practices = every row).
  const inScope: HubPractice[] = useMemo(() => {
    if (!data) return [];
    if (scope === 'all' || scope === 'practices') return data.practices;
    return data.practices.filter((p) => p.practiceId === scope);
  }, [data, scope]);

  const isGroupScope = scope === 'all' || scope === 'practices';
  const headlineRevenue = isGroupScope
    ? data?.group.revenuePence ?? 0
    : inScope.reduce((s, p) => s + p.revenuePence, 0);
  // Leads/conversion are ALWAYS the group total, even at practice scope. They
  // come from the paid channels (Google Ads + Meta) + the CRM, which run at the
  // group level and carry no practice_id — can't be split per-practice without
  // fabricating attribution. Org-wide figure (labelled "group") is the honest view.
  const leadsValue = data?.group.leads ?? 0;
  const conversionValue = data?.group.conversionRate ?? 0;
  // Named per-source sections under the Leads total: every acquisition source
  // (Google / Meta / GHL), shown even at zero so the mix is explicit.
  const leadsBreakdown = (data?.group.leadsBySource ?? [])
    .map((s) => `${s.source.split(' ')[0]} ${s.leads.toLocaleString('en-GB')}`)
    .join(' · ');

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
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 xl:grid-cols-6">
            <KpiTile label="Turnover" value={formatPence(headlineRevenue)} delta={data.period.label ?? `${data.period.days}-day window`} />
            <KpiTile label="Margin" value={`${data.group.marginPct}%`} delta="net, from actuals" deltaTone={data.group.marginPct >= 18 ? 'up' : data.group.marginPct > 0 ? 'muted' : 'down'} />
            <KpiTile label="Appointments" value={inScopeSum(inScope, 'appointments').toLocaleString('en-GB')} delta={`${inScopeSum(inScope, 'completed').toLocaleString('en-GB')} completed`} />
            <KpiTile label="No-show rate"
              value={data.group.noShowTracked ? `${rate(inScopeSum(inScope, 'noShows'), inScopeSum(inScope, 'appointments'))}%` : '—'}
              delta={data.group.noShowTracked ? `${inScopeSum(inScope, 'noShows').toLocaleString('en-GB')} no-shows` : 'not tracked in Dentally'}
              deltaTone="down" />
            <KpiTile label="Leads" value={leadsValue.toLocaleString('en-GB')} delta={leadsBreakdown || (isGroupScope ? 'Google · Meta · GHL' : 'all sources — all practices')} />
            <KpiTile label="Conversion" value={`${conversionValue}%`} delta={isGroupScope ? 'leads → new patients booked' : 'all sources — all practices'} deltaTone="up" />
          </div>

          <GhlSummaryCards />
        </>
      )}
    </div>
  );
}

function inScopeSum(rows: HubPractice[], k: keyof HubPractice): number {
  return rows.reduce((s, p) => s + (Number(p[k]) || 0), 0);
}
function rate(n: number, d: number): number {
  return d ? Math.round((n / d) * 1000) / 10 : 0;
}
