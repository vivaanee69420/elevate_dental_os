'use client';
// Google's data adapter for the shared summary view. Same contract as
// FacebookSummary: fetch with the report page's own hooks, render the one
// shared layout, so the two channels answer the same question the same way and
// neither can drift from the page it links to.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useScopePeriod } from '@/features/_shared/scope-context';
import { ScopePeriodBar } from '@/features/_shared/ScopePeriodBar';
import { ComparePicker, type CompareWindow } from '@/features/marketing/_shared/ComparePicker';
import { useGoogleLeadPerformance, useGoogleLeadPerformanceFor } from '@/features/marketing/google/hooks';
import { ChannelSummaryView } from './ChannelSummaryView';

const NOT_CONNECTED: Record<string, string> = {
  not_connected: 'Google Ads is not connected, so there is nothing to report yet.',
  never_synced: 'Google Ads is connected but has not synced yet.',
};

export function GoogleSummary() {
  const router = useRouter();
  const { win } = useScopePeriod();
  const since = win.since.slice(0, 10);
  const until = win.until.slice(0, 10);
  const [compare, setCompare] = useState<CompareWindow | null>(null);

  const { data, isPending, error } = useGoogleLeadPerformance();
  const prev = useGoogleLeadPerformanceFor(compare);

  return (
    <div className="flex flex-col gap-4">
      <ScopePeriodBar adProvider="google_ads" />
      <ComparePicker
        since={since}
        until={until}
        value={compare}
        onChange={(next) => setCompare(next)}
      />
      <ChannelSummaryView
        title="Google"
        reportHref="/marketing-google"
        isPending={isPending}
        error={(error as Error) ?? null}
        notConnected={data && data.state !== 'ok' ? (NOT_CONNECTED[data.state] ?? null) : null}
        total={data?.total ?? null}
        previous={prev.data?.total ?? null}
        campaigns={data?.campaigns ?? []}
        comparisonLabel={compare ? `vs ${compare.since} to ${compare.until}` : null}
        onOpenCampaign={(campaignId) =>
          router.push(`/marketing-google?tab=campaigns&campaignId=${encodeURIComponent(campaignId)}`)}
        // Four grains, not three: Google's ads and keywords are SIBLINGS under
        // an ad group rather than nested, so neither is reachable through the
        // other and both need their own way in.
        tiers={[
          { label: 'Campaigns', hint: 'Spend and cost per patient, campaign by campaign.', href: '/marketing-google?tab=campaigns' },
          { label: 'Ad groups', hint: 'Which group inside a campaign is carrying it.', href: '/marketing-google?tab=adgroups' },
          { label: 'Ads', hint: 'The individual ad and what it returned.', href: '/marketing-google?tab=ads' },
          { label: 'Keywords', hint: 'The words people actually typed.', href: '/marketing-google?tab=keywords' },
        ]}
      />
    </div>
  );
}
