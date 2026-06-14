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

import { useLeads } from '@/features/leads/hooks';

const STAGE_TONE = ['bg-brand', 'bg-success', 'bg-info', 'bg-accent'];

export function LeadFunnelScreen({ overrideAccountId }: { overrideAccountId?: string | null }) {
  const { scope } = useScopePeriod();
  const { data: hubData, isLoading: hubLoading, isError: hubError } = useBusinessHub();

  const isUsingGhlOverride = overrideAccountId !== undefined;
  
  const { data: leadData, isLoading: leadsLoading, isError: leadsError } = useLeads({
    limit: 500,
    ...(isUsingGhlOverride && overrideAccountId ? { integration_account_id: overrideAccountId } : {}),
  });

  const rows: HubPractice[] = useMemo(() => {
    if (isUsingGhlOverride || !hubData) return [];
    if (scope === 'all' || scope === 'practices') return hubData.practices;
    return hubData.practices.filter((p) => p.practiceId === scope);
  }, [hubData, scope, isUsingGhlOverride]);

  const { leads, booked, attended, accepted } = useMemo(() => {
    if (isUsingGhlOverride) {
      const list = leadData?.leads ?? [];
      const lCount = list.length;
      const bCount = list.filter((l) =>
        ['consultation_booked', 'consultation_attended', 'treatment_started', 'treatment_completed', 'failed_to_attend'].includes(l.status)
      ).length;
      const aCount = list.filter((l) =>
        ['consultation_attended', 'treatment_started', 'treatment_completed'].includes(l.status)
      ).length;
      const accCount = list.filter((l) =>
        ['treatment_started', 'treatment_completed'].includes(l.status)
      ).length;
      return { leads: lCount, booked: bCount, attended: aCount, accepted: accCount };
    } else {
      const sum = (k: keyof HubPractice) => rows.reduce((s, p) => s + (Number(p[k]) || 0), 0);
      const lCount = sum('leads');
      const bCount = sum('appointments');
      const aCount = sum('completed');
      const accCount = rows.reduce((s, p) => s + Math.round((p.leads * p.conversionRate) / 100), 0);
      return { leads: lCount, booked: bCount, attended: aCount, accepted: accCount };
    }
  }, [rows, leadData, isUsingGhlOverride]);

  const stages = [
    { label: 'Leads', value: leads },
    { label: 'Consults booked', value: booked },
    { label: 'Consults attended', value: attended },
    { label: 'Treatment accepted', value: accepted },
  ];
  const top = stages[0].value || 1;

  const isLoading = isUsingGhlOverride ? leadsLoading : hubLoading;
  const isError = isUsingGhlOverride ? leadsError : hubError;
  const notApplicable = !isUsingGhlOverride && hubData && (scope === 'academy' || scope === 'lab');

  const showContent = isUsingGhlOverride ? !isLoading && !isError : hubData && !notApplicable;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Lead Funnel"
        subtitle="Lead → consult → attended → accepted, with the drop-off at each stage. The biggest leak is the cheapest place to add profit."
      />
      {!isUsingGhlOverride && <ScopePeriodBar />}

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

      {showContent && (
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
