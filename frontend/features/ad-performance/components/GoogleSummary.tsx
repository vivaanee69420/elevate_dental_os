'use client';
// Google's data adapter. Same contract as FacebookSummary: fetch with the
// report page's own hooks, rank each grain with the same helper it ranks by,
// render the one shared layout — so the two channels answer the same question
// the same way and neither can drift from the page it links to.
//
// Google carries two grains Facebook does not. Ads and keywords are SIBLINGS
// under an ad group rather than nested, so neither is reachable through the
// other; and search terms are what people actually typed, as against the
// keywords that were bid on, which is a different question with a different
// answer.

import { useRouter } from 'next/navigation';
import { previousPeriod } from '@/features/marketing/_shared/compare';
import { bestByCostPerConversion } from '@/features/marketing/_shared/BestPerformer';
import {
  useGoogleLeadPerformance,
  useGoogleLeadPerformanceFor,
  useSelectedYmdWindow,
  useGoogleCampaigns,
  useGoogleAdGroups,
  useGoogleAds,
  useGoogleKeywords,
  useGoogleSearchTerms,
} from '@/features/marketing/google/hooks';
import { ChannelSummaryView, type Grain } from './ChannelSummaryView';

const NOT_OK: Record<string, string> = {
  not_connected:
    'Google Ads is not connected, so there is nothing to report yet.',
  never_synced: 'Google Ads is connected but has not synced yet.',
};

function noteFor(rows: unknown[] | undefined, best: unknown) {
  if (best || !rows) return null;
  return rows.length > 0
    ? `${rows.length} in this period, none with a conversion yet.`
    : null;
}

export function GoogleSummary() {
  const router = useRouter();
  const { since, until } = useSelectedYmdWindow();
  // ALWAYS the preceding period of the same length. There is no compare
  // button: a figure without a direction is half an answer, and behind a
  // control most readers never find it. Same length, so a 7-day view is
  // measured against 7 days rather than a whole month.
  const compare = previousPeriod(since, until);
  const previousLabel = `${compare.since} to ${compare.until}`;

  const { data, isPending, error } = useGoogleLeadPerformance();
  const prev = useGoogleLeadPerformanceFor(compare);

  // Null parent = the whole window at that grain, which is what a "best of"
  // needs; a parent id would rank within one campaign or ad group.
  const campaigns = useGoogleCampaigns();
  const adGroups = useGoogleAdGroups(null);
  const ads = useGoogleAds(null);
  const keywords = useGoogleKeywords(null);
  const searchTerms = useGoogleSearchTerms(null);

  // The three deep grains paginate, so their rows live across pages rather
  // than on one payload. Ranking only the first page would name the best of
  // whatever happened to load first and call it the best overall.
  const adRows = ads.data?.pages.flatMap((p) => p.rows) ?? [];
  const keywordRows = keywords.data?.pages.flatMap((p) => p.rows) ?? [];
  const termRows = searchTerms.data?.pages.flatMap((p) => p.rows) ?? [];

  // The `totals` row carries a null id and is the sum of the rows it would
  // compete against, so it wins every ranking if left in.
  const real = <T extends { id: string | null }>(rows: T[]) =>
    rows.filter((r) => r.id !== null);

  const bestCampaign = bestByCostPerConversion(
    real(campaigns.data?.rows ?? []),
  );
  const bestAdGroup = bestByCostPerConversion(real(adGroups.data?.rows ?? []));
  const bestAd = bestByCostPerConversion(real(adRows));
  const bestKeyword = bestByCostPerConversion(real(keywordRows));
  const bestTerm = bestByCostPerConversion(real(termRows));

  const grains: Grain[] = [
    {
      label: 'Best campaign · cost per conversion',
      row: bestCampaign,
      fallbackName: 'Unnamed campaign',
      note: noteFor(campaigns.data?.rows, bestCampaign),
      href: '/marketing-google?tab=campaigns',
    },
    {
      label: 'Best ad group · cost per conversion',
      row: bestAdGroup,
      fallbackName: 'Unnamed ad group',
      note: noteFor(adGroups.data?.rows, bestAdGroup),
      href: '/marketing-google?tab=adgroups',
    },
    {
      label: 'Best ad · cost per conversion',
      row: bestAd,
      fallbackName: 'Unnamed ad',
      note: noteFor(adRows, bestAd),
      href: '/marketing-google?tab=ads',
    },
    {
      label: 'Best keyword · cost per conversion',
      row: bestKeyword,
      fallbackName: 'Unnamed keyword',
      note: noteFor(keywordRows, bestKeyword),
      href: '/marketing-google?tab=keywords',
    },
    {
      label: 'Best search term · cost per conversion',
      row: bestTerm,
      fallbackName: 'Unnamed search term',
      note: noteFor(termRows, bestTerm),
      href: '/marketing-google?tab=searchterms',
    },
  ];

  return (
    <ChannelSummaryView
      title="Google"
      campaignsHref="/marketing-google?tab=campaigns"
      isPending={isPending}
      error={(error as Error) ?? null}
      notConnected={
        data && data.state !== 'ok' ? (NOT_OK[data.state] ?? null) : null
      }
      total={data?.total ?? null}
      previous={prev.data?.total ?? null}
      campaigns={data?.campaigns ?? []}
      grains={grains}
      previousLabel={previousLabel}
      onOpenCampaign={(campaignId) =>
        router.push(
          `/marketing-google?tab=campaigns&campaignId=${encodeURIComponent(campaignId)}`,
        )
      }
      onOpenGrain={(href) => router.push(href)}
    />
  );
}
