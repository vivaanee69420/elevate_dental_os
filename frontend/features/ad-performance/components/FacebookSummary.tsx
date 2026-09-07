'use client';
// Facebook's data adapter for the shared summary view.
//
// It fetches with the SAME hooks the Facebook report page uses, so the two
// surfaces cannot report different figures for the same window — the summary is
// a smaller view of one dataset, never a second calculation of it.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useScopePeriod } from '@/features/_shared/scope-context';
import { ScopePeriodBar } from '@/features/_shared/ScopePeriodBar';
import { ComparePicker, type CompareWindow } from '@/features/marketing/_shared/ComparePicker';
import { useFacebookLeadPerformance, useFacebookLeadPerformanceFor } from '@/features/marketing/facebook/hooks';
import { ChannelSummaryView } from './ChannelSummaryView';

const NOT_CONNECTED: Record<string, string> = {
  not_connected: 'Facebook Ads is not connected, so there is nothing to report yet.',
  never_synced: 'Facebook Ads is connected but has not synced yet.',
  no_ad_id_coverage: 'Facebook leads carry no ad id yet, so spend cannot be tied to leads.',
};

export function FacebookSummary() {
  const router = useRouter();
  const { win } = useScopePeriod();
  const since = win.since.slice(0, 10);
  const until = win.until.slice(0, 10);
  const [compare, setCompare] = useState<CompareWindow | null>(null);

  const { data, isPending, error } = useFacebookLeadPerformance();
  const prev = useFacebookLeadPerformanceFor(compare);

  return (
    <div className="flex flex-col gap-4">
      {/* Facebook's OWN window and practice filter. Meta's deep-grain tables
          hold a rolling 92 days and Google's do not, so one shared filter row
          would clamp one channel or the other without saying so. */}
      <ScopePeriodBar adProvider="meta_ads" />
      <ComparePicker
        since={since}
        until={until}
        value={compare}
        onChange={(next) => setCompare(next)}
      />
      <ChannelSummaryView
        title="Facebook"
        reportHref="/marketing-facebook"
        isPending={isPending}
        error={(error as Error) ?? null}
        notConnected={data && data.state !== 'ok' ? (NOT_CONNECTED[data.state] ?? null) : null}
        total={data?.total ?? null}
        previous={prev.data?.total ?? null}
        campaigns={data?.campaigns ?? []}
        comparisonLabel={compare ? `vs ${compare.since} to ${compare.until}` : null}
        onOpenCampaign={(campaignId) =>
          router.push(`/marketing-facebook?tab=campaigns&campaignId=${encodeURIComponent(campaignId)}`)}
        tiers={[
          { label: 'Campaigns', hint: 'Spend and cost per patient, campaign by campaign.', href: '/marketing-facebook?tab=campaigns' },
          { label: 'Ad sets', hint: 'Which audience inside a campaign is working.', href: '/marketing-facebook?tab=adsets' },
          { label: 'Ads', hint: 'The individual creative and what it returned.', href: '/marketing-facebook?tab=ads' },
        ]}
      />
    </div>
  );
}
