'use client';
// Marketing overview — spend, leads, cost per lead and real patients for the
// scoped window. Money is integer pence; display via formatPence.
//
// Leads that became patients is measured against Dentally, NOT the ad
// platforms' own conversion counter. Both are shown, labelled distinctly:
// Google and Facebook count a form submission, we count someone who walked in.
import { PageHeader, KpiTile, EmptyState, SkeletonKpiRow } from '@/components/ui';
import { formatPence } from '@/lib/format';
import { ScopePeriodBar } from '@/features/_shared/ScopePeriodBar';
import { useMarketingPerformance } from '../hooks';

const money = (p: number | null) => (p === null ? '—' : formatPence(p));

export default function MarketingOverviewScreen() {
  const { data, isLoading, isError, error } = useMarketingPerformance();
  const t = data?.totals;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Marketing overview"
        subtitle="Spend, leads and real patients per campaign, measured against your own records."
      />
      <ScopePeriodBar />
      {isError ? (
        <EmptyState message={`Couldn't load marketing data: ${(error as Error)?.message ?? 'unknown error'}`} />
      ) : isLoading || !t ? (
        <SkeletonKpiRow count={5} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <KpiTile label="Ad spend" value={money(t.spendPence)} />
            <KpiTile label="Leads" value={t.leads.toLocaleString('en-GB')} />
            <KpiTile label="Cost per lead" value={money(t.costPerLeadPence)} />
            <KpiTile label="Became patients" value={t.patients.toLocaleString('en-GB')} />
            <KpiTile label="Cost per patient" value={money(t.costPerPatientPence)} />
          </div>
          {t.unattributedLeads > 0 ? (
            <p className="text-[13px] text-ink-muted">
              {t.unattributedLeads.toLocaleString('en-GB')} leads in this window carry no ad
              tracking, so they are counted in the lead total but not against any campaign.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
