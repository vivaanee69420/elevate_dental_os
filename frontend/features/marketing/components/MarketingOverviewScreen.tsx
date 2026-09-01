'use client';
// Marketing overview — spend, leads and real patients for the scoped window,
// then where that money went.
//
// Leads that became patients is measured against Dentally, NOT the ad
// platforms' own conversion counter. Both are shown, labelled distinctly:
// Google and Facebook count a form submission, we count someone who walked in.
//
// Everything below the tiles reads the SAME payload as the tiles — one query,
// one window, one set of campaigns — so no panel on this page can disagree
// with another.
import {
  PageHeader, KpiTile, EmptyState, SkeletonKpiRow, SkeletonChart,
} from '@/components/ui';
import { formatPence } from '@/lib/format';
import dynamic from 'next/dynamic';
import { ScopePeriodBar } from '@/features/_shared/ScopePeriodBar';
import { useScopePeriod } from '@/features/_shared/scope-context';
import { usePractices } from '@/features/practices/hooks';
import { useMarketingPerformance } from '../hooks';
import { CoverageNotice } from './CoverageNotice';
import { ChannelCards } from './ChannelCards';
import { TopCampaigns } from './TopCampaigns';

// recharts is the heaviest dependency on the page and the only thing on it that
// needs a browser. Loading it as its own chunk keeps it out of the initial
// bundle — the tiles, the notice and both tables paint without waiting for a
// charting library, and a viewer who never scrolls never pays for it.
const SpendTrend = dynamic(
  () => import('./SpendTrend').then((m) => m.SpendTrend),
  { ssr: false, loading: () => <SkeletonChart /> },
);

const money = (p: number | null) => (p === null ? '—' : formatPence(p));

export default function MarketingOverviewScreen() {
  const { data, isLoading, isError, error } = useMarketingPerformance();
  const { scope } = useScopePeriod();
  const { data: practiceData } = usePractices();
  const t = data?.totals;

  const practiceName = scope && scope !== 'all'
    ? practiceData?.practices?.find((p) => p.id === scope)?.name ?? null
    : null;

  if (isError) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Marketing overview" />
        <EmptyState message={`Couldn't load marketing data: ${(error as Error)?.message ?? 'unknown error'}`} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Marketing overview"
        subtitle="Spend, leads and real patients per campaign, measured against your own records."
      />
      <ScopePeriodBar />

      {isLoading || !t || !data ? (
        <>
          <SkeletonKpiRow count={5} />
          <SkeletonChart />
        </>
      ) : (
        <>
          <CoverageNotice coverage={data.coverage} practiceName={practiceName} />

          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <KpiTile label="Ad spend" value={money(t.spendPence)} />
            <KpiTile label="Leads" value={t.leads.toLocaleString('en-GB')} />
            <KpiTile label="Cost per lead" value={money(t.costPerLeadPence)} />
            <KpiTile label="Became patients" value={t.patients.toLocaleString('en-GB')} />
            <KpiTile label="Cost per patient" value={money(t.costPerPatientPence)} />
          </div>

          {t.unattributedLeads > 0 ? (
            <p className="text-[13px] text-ink-muted">
              Leads and patients count everyone who enquired in this window, however they
              found you.
              {' '}
              {t.attributedLeads.toLocaleString('en-GB')}
              {' '}
              of them are matched to a campaign with spend
              {t.patients > 0 ? `, ${t.attributedPatients.toLocaleString('en-GB')} of the ${t.patients.toLocaleString('en-GB')} patients among them` : ''}
              , and only those are used as the denominators for cost per lead and cost per
              patient — charging paid spend against organic enquiries would understate both.
              The other
              {' '}
              {t.unattributedLeads.toLocaleString('en-GB')}
              {' '}
              carry no ad tracking. The cards below split all of it by channel.
            </p>
          ) : null}

          <ChannelCards rows={data.byChannel} />

          <SpendTrend series={data.series} />

          <TopCampaigns rows={data.rows} />

          {data.rows.length === 0 && data.coverage.totalAccounts > 0 ? (
            <EmptyState message="No campaign had spend in this window. Try a wider period, or check that the advertising accounts are still syncing under Integrations." />
          ) : null}
        </>
      )}
    </div>
  );
}
