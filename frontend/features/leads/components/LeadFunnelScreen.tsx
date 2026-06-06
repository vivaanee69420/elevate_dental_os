'use client';

// Lead Funnel (GM Intelligence OS). Lead -> booked -> attended -> accepted, with
// each stage's drop-off. Derived from the real business-hub rollup (leads,
// appointments, completed, conversion). Scope-aware. The biggest leak is the
// cheapest place to add profit.

import { useMemo } from 'react';
import { PageHeader, KpiTile, BarRow, EmptyState, AlertRow, SkeletonKpiRow, SkeletonChart } from '@/components/ui';
import { ScopePeriodBar } from '@/features/_shared/ScopePeriodBar';
import { useScopePeriod } from '@/features/_shared/scope-context';
import { useBusinessHub, type HubPractice } from '@/features/overview/business-hub-api';

const STAGE_TONE = ['bg-brand', 'bg-success', 'bg-info', 'bg-accent'];

export function LeadFunnelScreen() {
  const { scope } = useScopePeriod();
  const { data, isLoading, isError } = useBusinessHub();

  const rows: HubPractice[] = useMemo(() => {
    if (!data) return [];
    if (scope === 'all' || scope === 'practices') return data.practices;
    return data.practices.filter((p) => p.practiceId === scope);
  }, [data, scope]);

  const sum = (k: keyof HubPractice) => rows.reduce((s, p) => s + (Number(p[k]) || 0), 0);
  const leads = sum('leads');
  const booked = sum('appointments');
  const attended = sum('completed');
  const accepted = rows.reduce((s, p) => s + Math.round((p.leads * p.conversionRate) / 100), 0);

  const stages = [
    { label: 'Leads', value: leads },
    { label: 'Consults booked', value: booked },
    { label: 'Consults attended', value: attended },
    { label: 'Treatment accepted', value: accepted },
  ];
  const top = stages[0].value || 1;

  const notApplicable = data && (scope === 'academy' || scope === 'lab');

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Lead Funnel"
        subtitle="Lead → consult → attended → accepted, with the drop-off at each stage. The biggest leak is the cheapest place to add profit."
      />
      <ScopePeriodBar />

      {isLoading && (
        <>
          <SkeletonKpiRow count={4} />
          <SkeletonChart height={260} />
        </>
      )}
      {isError && <AlertRow tone="bad" title="Couldn't load the funnel" />}
      {notApplicable && (
        <AlertRow tone="info" title="The funnel covers clinical practices" body="Switch scope to the group or a practice." />
      )}

      {data && !notApplicable && (
        <>
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
            <KpiTile label="Lead → accepted" value={`${leads ? Math.round((accepted / leads) * 1000) / 10 : 0}%`} delta={`${accepted.toLocaleString('en-GB')} accepted from ${leads.toLocaleString('en-GB')} leads`} deltaTone="up" />
            <KpiTile label="Booked → attended" value={`${booked ? Math.round((attended / booked) * 1000) / 10 : 0}%`} delta={`${(booked - attended).toLocaleString('en-GB')} no-show/cancelled`} deltaTone={booked && attended / booked >= 0.85 ? 'up' : 'down'} />
            <KpiTile label="Attended → accepted" value={`${attended ? Math.round((accepted / attended) * 1000) / 10 : 0}%`} delta="chairside acceptance" />
          </div>

          <div className="card-padded">
            <h3 className="display text-lg mb-3">Lead to treatment funnel</h3>
            {stages.map((st, i) => {
              const prev = i ? stages[i - 1].value : st.value;
              const drop = prev ? Math.round((1 - st.value / prev) * 100) : 0;
              return (
                <BarRow
                  key={st.label}
                  name={st.label}
                  sub={i ? `-${drop}% drop` : 'top of funnel'}
                  pct={(st.value / top) * 100}
                  value={st.value.toLocaleString('en-GB')}
                  valueSub={`${Math.round((st.value / top) * 100)}% of leads`}
                  tone={STAGE_TONE[i]}
                />
              );
            })}
            <p className="text-[11px] text-ink-soft mt-3">
              Booked→attended is usually the most fixable leak (reminders, deposits, speed-to-lead). Acceptance lifts on existing leads cost nothing in ad spend.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
