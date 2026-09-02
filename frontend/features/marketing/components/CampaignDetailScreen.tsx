'use client';
// One campaign, end to end: what it cost, how far the people it produced got,
// and who they were.
//
// No new endpoint. The header and funnel come from the campaigns payload the
// table already fetched and cached, and the people come from the leads endpoint
// with a campaign filter. Two calls the app was already making.
import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { PageHeader, EmptyState, SkeletonTable } from '@/components/ui';
import { formatPence } from '@/lib/format';
import { ScopePeriodBar } from '@/features/_shared/ScopePeriodBar';
import { useMarketingPerformance, useMarketingLeads } from '../hooks';
import { MarketingLeadsTable } from './MarketingLeadsTable';
import { CHANNEL_LABEL } from '../api';

const SIZE = 50;
const money = (p: number | null) => (p === null ? '—' : formatPence(p));
const count = (n: number) => n.toLocaleString('en-GB');

// A stage and the cost of reaching it. The cost is null, never zero, when
// nobody reached this stage — £0.00 would read as "free".
function Stage({ label, value, cost, costLabel, note }: {
  label: string; value: string; cost?: string; costLabel?: string; note?: string;
}) {
  return (
    <div className="flex-1 rounded-panel border border-border bg-surface px-4 py-3">
      <div className="text-[12px] uppercase tracking-wide text-ink-muted">{label}</div>
      <div className="mt-1 text-[22px] font-semibold text-ink">{value}</div>
      {cost ? (
        <div className="mt-1 text-[12.5px] text-ink-muted">{costLabel} {cost}</div>
      ) : null}
      {note ? <div className="mt-1 text-[12px] text-ink-muted">{note}</div> : null}
    </div>
  );
}

export default function CampaignDetailScreen() {
  const params = useParams<{ campaignId: string }>();
  const campaignId = decodeURIComponent(String(params?.campaignId ?? ''));
  const [page, setPage] = useState(1);

  const { data, isLoading, isError, error } = useMarketingPerformance();
  const campaign = (data?.rows ?? []).find((r) => r.campaignId === campaignId) ?? null;
  const leads = useMarketingLeads({ page, size: SIZE, channel: null, converted: 'any', campaignId });

  const total = leads.data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / SIZE));

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={campaign?.campaignName ?? campaignId}
        subtitle={campaign
          ? `${CHANNEL_LABEL[campaign.provider] ?? campaign.provider} campaign. Attendance is recorded in Dentally only.`
          : 'Campaign'}
      />
      <div>
        <Link href="/marketing-campaigns" className="text-[13px] text-brand hover:underline">
          Back to campaigns
        </Link>
      </div>
      <ScopePeriodBar />

      {isError ? (
        <EmptyState message={`Couldn't load this campaign: ${(error as Error)?.message ?? 'unknown error'}`} />
      ) : isLoading ? (
        <SkeletonTable rows={6} cols={5} />
      ) : !campaign ? (
        <EmptyState message="This campaign had no spend in the selected window. Widen the period or choose another campaign." />
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Stage label="Spend" value={money(campaign.spendPence)} />
          <Stage
            label="Leads" value={count(campaign.leads)}
            costLabel="Cost per lead" cost={money(campaign.costPerLeadPence)}
          />
          <Stage
            label="Booked" value={count(campaign.booked)}
            costLabel="Cost per booking" cost={money(campaign.costPerBookingPence)}
          />
          <Stage
            label="Attended" value={count(campaign.attended)}
            note="Dentally only — a booking made in GoHighLevel has no attendance record."
          />
          <Stage
            label="New patients" value={count(campaign.newPatients)}
            costLabel="Cost per new patient" cost={money(campaign.costPerNewPatientPence)}
            note="Not necessarily one of the bookings above — someone can register as a patient with no booking recorded here."
          />
        </div>
      )}

      {leads.isLoading ? (
        <SkeletonTable rows={8} cols={7} />
      ) : total === 0 ? (
        <EmptyState message="No enquiries are attributed to this campaign in this window." />
      ) : (
        <>
          <MarketingLeadsTable rows={leads.data?.rows ?? []} />

          <div className="flex items-center justify-between text-[13px] text-ink-muted">
            <span>
              {((page - 1) * SIZE) + 1}
              –
              {Math.min(page * SIZE, total)}
              {' of '}
              {total.toLocaleString('en-GB')}
            </span>
            <span className="flex gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded-lg border border-border bg-surface px-3 py-1.5 text-[13px] text-ink-muted hover:bg-bg"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(lastPage, p + 1))}
                className="rounded-lg border border-border bg-surface px-3 py-1.5 text-[13px] text-ink-muted hover:bg-bg"
              >
                Next
              </button>
            </span>
          </div>
        </>
      )}
    </div>
  );
}
