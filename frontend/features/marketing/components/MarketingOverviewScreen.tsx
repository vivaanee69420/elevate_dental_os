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
import Link from 'next/link';
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
            {/* Same rule as the Facebook and Google pages: a new patient whose
                settled payments exceed the acceptance floor. It used to mean
                "matched any Dentally record", which read 729 here against 86 on
                those pages for the same window. */}
            <KpiTile
              label="Patients from ads"
              value={t.patients.toLocaleString('en-GB')}
              delta={`Paid over ${money(data.acceptanceMinPaidPence)} after enquiring`}
            />
            <KpiTile label="Cost per patient" value={money(t.costPerPatientPence)} />
          </div>

          <p className="text-[13px] text-ink-muted">
            Every figure here is Facebook and Google only — the same numbers as the
            {' '}
            <Link href="/marketing-facebook" className="underline">Facebook</Link>
            {' '}
            and
            {' '}
            <Link href="/marketing-google" className="underline">Google</Link>
            {' '}
            pages, for the practice and period selected above.
            {' '}
            <strong className="font-medium text-ink">Patients from ads</strong>
            {' '}
            counts a lead who went on to pay more than
            {' '}
            {money(data.acceptanceMinPaidPence)}
            .
            {t.unattributedLeads > 0 ? (
              <>
                {' '}
                A further
                {' '}
                {t.unattributedLeads.toLocaleString('en-GB')}
                {' '}
                enquiries arrived with no ad tracking; they are not advertising
                results, so they are excluded here and listed on the
                {' '}
                <Link href="/marketing-leads" className="underline">Leads</Link>
                {' '}
                page.
              </>
            ) : null}
          </p>

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
