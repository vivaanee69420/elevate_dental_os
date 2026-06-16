'use client';

// Day — Cash Collected (GM Intelligence OS). Cash COLLECTED by working day across
// the month in scope, plus a composite cash-collection index. This view is cash
// receipts, NOT production (decision A2 / T9) — every figure is labelled so it is
// never mistaken for billed work.
//
// WIRED: reads GET /api/analytics/cash-by-day (real settled receipts by
// processed_at date, scope/period reactive). Money is integer PENCE.

import { PageHeader, KpiTile, BarRow, AlertRow, EmptyState, SkeletonKpiRow, SkeletonChart } from '@/components/ui';
import { formatPence } from '@/lib/format';
import { ScopePeriodBar } from '@/features/_shared/ScopePeriodBar';
import { Panel, PanelHead, NoteFoot, Pill } from './os-ui';
import { DecisionLens } from '@/features/_shared/DecisionLens';
import { useCashByDay } from '../cash-by-day-hooks';

export default function DayScreen() {
  const { data, isLoading, isError, error } = useCashByDay();

  const maxCash = Math.max(...(data?.days.map((d) => d.pence) ?? [0]), 1);
  const selectedKey = data?.selected?.date ?? null;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Day — Cash Collected" subtitle="Cash banked by working day across the month in scope, with a composite collection index. This is cash receipts, not billed production." />
      <ScopePeriodBar dentallyOnly />

      <AlertRow tone="info" title="Cash collected, not production" body="Day figures track money banked by date, not treatment value billed. Production stays month-only — use P&L & Margin or Treatment Mix for billed work." />

      {isError ? (
        <Panel><EmptyState message={`Couldn't load cash receipts: ${(error as Error)?.message ?? 'unknown error'}`} /></Panel>
      ) : isLoading ? (
        <>
          <SkeletonKpiRow count={4} />
          <SkeletonChart height={260} />
        </>
      ) : !data?.hasData ? (
        <Panel>
          <PanelHead title="Cash collected by day" sub={data?.monthLabel} />
          <EmptyState message="No settled receipts banked in this month for the selected scope. Connect a payments feed (Dentally/Stripe) or pick a month with activity." />
        </Panel>
      ) : (
        <>
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <KpiTile label={`Cash collected · ${data.monthLabel}`} value={formatPence(data.totalPence)} delta={`${data.workingDays} working days`} />
            <KpiTile label="Avg per working day" value={formatPence(data.avgPerDayPence)} delta="Month cash ÷ working days" />
            <KpiTile label="Peak day" value={data.peak ? formatPence(data.peak.pence) : '—'} delta={data.peak?.label} deltaTone="up" />
            <KpiTile
              label="Composite index"
              value={data.selected ? Math.round(data.selected.index).toString() : '100'}
              delta={data.selected ? `${data.selected.label} vs avg day (100)` : 'Select a day in the bar above'}
              deltaTone={data.selected ? (data.selected.index >= 100 ? 'up' : 'down') : 'muted'}
            />
          </div>

          <Panel>
            <PanelHead title="Cash collected by day" sub="Each working day's banked cash and its index against the average day (100). Saturdays run light; empty Sundays are excluded." right={<Pill tone="info">{data.monthLabel}</Pill>} />
            {data.days.map((r) => (
              <BarRow
                key={r.date}
                name={r.label}
                sub={`index ${Math.round(r.index)}`}
                pct={(r.pence / maxCash) * 100}
                value={formatPence(r.pence)}
                valueSub={selectedKey === r.date ? 'selected' : undefined}
                tone={selectedKey === r.date ? 'bg-gold' : 'bg-brand'}
              />
            ))}
            <NoteFoot>
              Real settled receipts by banked date. The composite index normalises each day to the month&apos;s average working day, so a value of 120 means that day banked 20% above the norm.
            </NoteFoot>
          </Panel>

          <Panel>
            <PanelHead title="Decision Lens" sub="What to act on for collections this week." />
            <DecisionLens surface="day" fallback={data.insights} />
          </Panel>
        </>
      )}
    </div>
  );
}
