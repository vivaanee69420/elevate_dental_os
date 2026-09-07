'use client';
// Facebook's data adapter for the shared summary view.
//
// Every fetch here is the Facebook report page's OWN hook, so the two surfaces
// cannot report different figures for the same window — this is a smaller view
// of one dataset, never a second calculation of it. That includes the per-grain
// winners: each grain is ranked by cost per conversion with the SAME helper the
// report page ranks by, so the two can never disagree about which row is best.
//
// The grain hooks are called with a null parent, which is how those endpoints
// mean "everything in this window" rather than "nothing" — the same call the
// report page's unfiltered tab makes.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ComparePicker, type CompareWindow } from '@/features/marketing/_shared/ComparePicker';
import { bestByCostPerConversion, type Performer } from '@/features/marketing/_shared/BestPerformer';
import type { FacebookRow } from '@/features/marketing/facebook/api';
import {
  useFacebookLeadPerformance, useFacebookLeadPerformanceFor,
  useFacebookCampaigns, useFacebookAdSets, useFacebookAds,
} from '@/features/marketing/facebook/hooks';
import { useSelectedYmdWindow } from '@/features/marketing/facebook/hooks';
import { ChannelSummaryView, type Grain } from './ChannelSummaryView';

// Each state is a DIFFERENT problem with a different fix, so each says so
// rather than sharing one "no data" line the owner cannot act on.
const NOT_OK: Record<string, string> = {
  not_connected: 'Facebook Ads is not connected, so there is nothing to report yet.',
  never_synced: 'Facebook Ads is connected but has not synced yet.',
  no_ad_id_coverage:
    'Facebook leads are arriving without an ad id, so spend cannot yet be tied to the leads it produced.',
};

/**
 * Facebook ranks by COST PER PATIENT, not by conversions.
 *
 * Meta's `actions` are never requested at ad-set or ad grain, so a conversions
 * column there would be a permanent zero — which is precisely why the Facebook
 * report page uses the CRM funnel instead. Ranking on a field the channel does
 * not populate would silently return "no best performer" at every grain below
 * campaign. Google's page ranks by its own tracked conversions; the two differ
 * on purpose, and each card says which measure it used.
 */
function asPerformers(rows: FacebookRow[] | undefined): Performer[] {
  return (rows ?? [])
    // The aggregate `totals` row carries a null id and would otherwise win
    // every ranking by being the sum of the rows it competes against.
    .filter((r) => r.id !== null)
    .map((r) => ({
      id: r.id,
      name: r.name,
      spendPence: r.spendPence,
      conversions: r.patients,
      costPerConversionPence: r.cpaPence,
    }));
}

/** Rows that exist but none of which converted. Naming that is the difference
 *  between "nothing qualified" and "this failed to load". */
function noteFor(rows: unknown[] | undefined, best: unknown) {
  if (best || !rows) return null;
  return rows.length > 0 ? `${rows.length} in this period, none with a conversion yet.` : null;
}

export function FacebookSummary() {
  const router = useRouter();
  const { since, until } = useSelectedYmdWindow();
  const [compare, setCompare] = useState<CompareWindow | null>(null);

  const { data, isPending, error } = useFacebookLeadPerformance();
  const prev = useFacebookLeadPerformanceFor(compare);

  // Unfiltered: the whole window at each grain, which is what a "best of"
  // needs. A parent id here would rank within one campaign or ad set.
  const campaigns = useFacebookCampaigns();
  const adSets = useFacebookAdSets(null);
  const ads = useFacebookAds(null);
  // Ads paginate, so the rows live across pages rather than on one payload.
  const adRows = ads.data?.pages.flatMap((pg) => pg.rows) ?? [];

  const bestCampaign = bestByCostPerConversion(asPerformers(campaigns.data?.rows));
  const bestAdSet = bestByCostPerConversion(asPerformers(adSets.data?.rows));
  const bestAd = bestByCostPerConversion(asPerformers(adRows));

  const grains: Grain[] = [
    {
      label: 'Best campaign · cost per patient', row: bestCampaign, fallbackName: 'Unnamed campaign',
      note: noteFor(campaigns.data?.rows, bestCampaign),
      href: '/marketing-facebook?tab=campaigns',
    },
    {
      label: 'Best ad set · cost per patient', row: bestAdSet, fallbackName: 'Unnamed ad set',
      note: noteFor(adSets.data?.rows, bestAdSet),
      href: '/marketing-facebook?tab=adsets',
    },
    {
      label: 'Best ad · cost per patient', row: bestAd, fallbackName: 'Unnamed ad',
      note: noteFor(adRows, bestAd),
      href: '/marketing-facebook?tab=ads',
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <ComparePicker since={since} until={until} value={compare} onChange={setCompare} />
      <ChannelSummaryView
        title="Facebook"
        reportHref="/marketing-facebook"
        isPending={isPending}
        error={(error as Error) ?? null}
        notConnected={data && data.state !== 'ok' ? (NOT_OK[data.state] ?? null) : null}
        total={data?.total ?? null}
        previous={prev.data?.total ?? null}
        campaigns={data?.campaigns ?? []}
        grains={grains}
        comparisonLabel={compare ? `vs ${compare.since} to ${compare.until}` : null}
        onOpenCampaign={(campaignId) =>
          router.push(`/marketing-facebook?tab=campaigns&campaignId=${encodeURIComponent(campaignId)}`)}
        onOpenGrain={(href) => router.push(href)}
      />
    </div>
  );
}
