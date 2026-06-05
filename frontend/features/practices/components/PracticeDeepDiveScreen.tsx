'use client';

// Practice Deep Dive (GM Intelligence OS). Everything about one site in one
// place — driven by the global Scope switcher. Composes the real business-hub
// rollup (turnover, demand, conversion) with the chair endpoint (occupancy,
// cost of empty chairs, recovery). Treatment mix + channel ROI land once the
// practice-x-treatment RPC exists.

import { useMemo } from 'react';
import { PageHeader, KpiTile, EmptyState, AlertRow } from '@/components/ui';
import { ScopePeriodBar } from '@/features/_shared/ScopePeriodBar';
import { useScopePeriod } from '@/features/_shared/scope-context';
import { formatPence } from '@/lib/format';
import { useBusinessHub, type HubPractice } from '@/features/overview/business-hub-api';
import { useChairAnalytics } from '@/features/operations/chair-analytics-hooks';

export function PracticeDeepDiveScreen() {
  const { scope } = useScopePeriod();
  const hub = useBusinessHub();
  const chair = useChairAnalytics(10);

  const isSinglePractice = scope !== 'all' && scope !== 'practices' && scope !== 'academy' && scope !== 'lab';

  const hubRow: HubPractice | undefined = useMemo(
    () => hub.data?.practices.find((p) => p.practiceId === scope),
    [hub.data, scope],
  );
  const chairRow = useMemo(
    () => chair.data?.applicable ? chair.data.practices?.find((p) => p.id === scope) : undefined,
    [chair.data, scope],
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Practice Deep Dive"
        subtitle="Everything about one site — pick a practice in the scope selector to drill into its turnover, demand, conversion and chair economics."
      />
      <ScopePeriodBar />

      {(scope === 'academy' || scope === 'lab') && (
        <AlertRow tone="info" title="Deep Dive covers clinical practices"
          body="Academy and Lab are summarised on Overview, P&L and Valuation. Pick a practice here." />
      )}

      {!isSinglePractice && scope !== 'academy' && scope !== 'lab' && (
        <AlertRow tone="info" title="Select a practice"
          body="Use the Scope selector above to choose a single practice — the deep dive is per-site." />
      )}

      {isSinglePractice && (hub.isLoading || chair.isLoading) && <EmptyState message="Loading practice…" />}

      {isSinglePractice && !hub.isLoading && !hubRow && (
        <AlertRow tone="warn" title="No data for this practice in the window" />
      )}

      {isSinglePractice && hubRow && (
        <>
          <div className="card-padded" style={{ background: 'linear-gradient(135deg,#fff,var(--brand-50))' }}>
            <div className="text-[11px] uppercase tracking-wider text-brand font-semibold">Practice</div>
            <div className="display text-2xl mt-1">{hubRow.name}</div>
            <div className="flex flex-wrap gap-x-10 gap-y-3 mt-4">
              <Stat label="Turnover" value={formatPence(hubRow.revenuePence)} />
              <Stat label="Chairs" value={String(hubRow.chairs)} />
              <Stat label="Appointments" value={hubRow.appointments.toLocaleString('en-GB')} />
              <Stat label="No-show" value={`${hubRow.noShowRate}%`} />
              <Stat label="Conversion" value={`${hubRow.conversionRate}%`} />
              {chairRow && <Stat label="Chair occupancy" value={`${chairRow.occupancyPct}%`} />}
            </div>
          </div>

          {chairRow && (
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
              <KpiTile label="Cost of empty chairs" value={formatPence(chairRow.lostPotentialYrPence)} delta={`${chairRow.emptyHrsYr.toLocaleString('en-GB')} empty hrs/yr`} deltaTone="down" />
              <KpiTile label="Recoverable to benchmark" value={formatPence(chairRow.recoverRevYrPence)} delta="at own yield/hr" deltaTone="up" />
              <KpiTile label="Revenue / booked chair-hr" value={formatPence(chairRow.revPerBookedHrPence)} delta={chairRow.utilAssumed ? 'occupancy assumed' : 'from data'} />
            </div>
          )}

          <AlertRow tone="info" title="Treatment mix & channel ROI coming to this view"
            body="Per-site treatment mix and marketing channel return need the practice x treatment data source (next backend slice)." />
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-ink-soft">{label}</div>
      <div className="display text-xl mt-0.5">{value}</div>
    </div>
  );
}
