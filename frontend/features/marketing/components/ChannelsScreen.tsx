'use client';
// Channels over time — the last twelve months rather than the selected one.
//
// This page deliberately ignores the period part of the scope bar: a trend of
// one point is not a trend. The PRACTICE part still applies, so it follows the
// practice filter like every other screen.
import dynamic from 'next/dynamic';
import { PageHeader, EmptyState, SkeletonChart } from '@/components/ui';
import { formatPence } from '@/lib/format';
import { ScopePeriodBar } from '@/features/_shared/ScopePeriodBar';
import { useMarketingTrend } from '../hooks';
import { CHANNEL_COLOUR, CHANNEL_LABEL, type Channel, type TrendMonth } from '../api';

// recharts is the heaviest thing on the page and the only part that needs a
// browser; its own chunk keeps it out of the initial bundle.
const ChannelsTrend = dynamic(
  () => import('./ChannelsTrend').then((m) => m.ChannelsTrend),
  { ssr: false, loading: () => <SkeletonChart /> },
);

const money = (p: number | null) => (p === null ? '—' : formatPence(p));
const PAID: Channel[] = ['meta_ads', 'google_ads'];

// Twelve-month totals per channel, so the chart has a summary to be read
// against. Cost per lead here is the WHOLE period's spend over the whole
// period's leads — not an average of the monthly rates, which would weight a
// quiet month the same as a busy one.
function periodTotals(months: TrendMonth[], channel: Channel) {
  const spendPence = months.reduce((n, m) => n + m.channels[channel].spendPence, 0);
  const leads = months.reduce((n, m) => n + m.channels[channel].leads, 0);
  const newPatients = months.reduce((n, m) => n + m.channels[channel].newPatients, 0);
  return {
    spendPence,
    leads,
    newPatients,
    costPerLeadPence: spendPence > 0 && leads > 0 ? Math.round(spendPence / leads) : null,
    costPerNewPatientPence: spendPence > 0 && newPatients > 0
      ? Math.round(spendPence / newPatients) : null,
  };
}

export default function ChannelsScreen() {
  const { data, isLoading, isError, error } = useMarketingTrend(12);
  const months = data?.months ?? [];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Channels over time"
        subtitle="Twelve months of Facebook and Google — whether a lead is getting cheaper or dearer, not just what it cost this month."
      />
      <ScopePeriodBar />
      <p className="-mt-1 text-[13px] text-ink-muted">
        This page always shows the last twelve months. The practice filter applies; the
        period buttons do not, because a trend needs more than one point.
      </p>

      {isError ? (
        <EmptyState message={`Couldn't load the trend: ${(error as Error)?.message ?? 'unknown error'}`} />
      ) : isLoading && !data ? (
        <SkeletonChart />
      ) : months.length === 0 ? (
        <EmptyState message="No advertising history yet. Once a month of spend and leads has synced, the trend appears here." />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {PAID.map((c) => {
              const t = periodTotals(months, c);
              return (
                <div key={c} className="rounded-panel border border-border bg-surface p-4">
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ background: CHANNEL_COLOUR[c] }}
                    />
                    <span className="text-[14px] font-medium text-ink">{CHANNEL_LABEL[c]}</span>
                    <span className="ml-auto text-[12.5px] text-ink-muted">12 months</span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
                    {[
                      ['Spend', t.spendPence > 0 ? money(t.spendPence) : '—'],
                      ['Leads', t.leads.toLocaleString('en-GB')],
                      ['Cost per lead', money(t.costPerLeadPence)],
                      ['Cost per new patient', money(t.costPerNewPatientPence)],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <div className="text-[11.5px] uppercase tracking-wide text-ink-muted">{label}</div>
                        <div className="mt-0.5 text-[17px] font-semibold tabular-nums text-ink">{value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <ChannelsTrend months={months} />

          <p className="text-[13px] leading-relaxed text-ink-muted">
            Cost per lead over the whole twelve months divides total spend by total leads,
            rather than averaging the monthly rates — an average would weight a quiet month
            the same as a busy one.
          </p>
        </>
      )}
    </div>
  );
}
