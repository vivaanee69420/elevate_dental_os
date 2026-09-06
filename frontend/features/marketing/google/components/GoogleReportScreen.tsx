'use client';
// ============================================================================
// Google report — one page, FIVE tabs: Campaigns / Ad groups / Ads / Keywords
// / Search terms.
//
// Google's hierarchy is Campaign -> Ad Group -> { Ads, Keywords }, with search
// terms hanging off the ad group as a report rather than an entity. Ads and
// keywords are SIBLINGS — neither contains the other — which is why this page
// has more tabs than the Facebook one, whose hierarchy is a straight
// Campaign -> Ad Set -> Ad chain.
//
// WHAT CHANGED IN THIS PASS, and why it is worth a note:
//
//  * THE AD-GROUP ROW NO LONGER TELEPORTS. It used to set `?tab=ads&parentId=`
//    — click an ad group, land on a different tab, looking at a list of ads
//    that (measured live) had no names at all. An ad group has TWO kinds of
//    child, so navigating to one was choosing for the reader with no basis for
//    the choice. It now expands in place and shows both.
//
//    NO ROW ON THIS PAGE NAVIGATES ON CLICK ANY MORE. A campaign row expands
//    too — it also has two useful destinations, Google's delivery detail and
//    its ad groups — and offers the second as an explicit link inside the
//    panel. One rule for the whole page: a click opens, a link moves you.
//
//  * `parentId` therefore no longer arrives from a row click. It survives as a
//    URL filter because Ads, Keywords and Search terms all honour one and a
//    filtered view stays shareable, but nothing on this page sets it any more.
//
//  * ONE CAMPAIGN TABLE, NOT TWO. The per-campaign breakdown (migration
//    000165) first landed in the panel above the tab strip — while the tab
//    strip's first tab was already Campaigns. The same six campaigns were
//    listed twice on one screen in two tables with different columns. They
//    are merged onto the Campaigns tab, which now carries both the money
//    columns and Google's own delivery figures.
//
// Filters live in the URL beside `tab`, so a view is shareable and the back
// button works. A tab that cannot honour the current filter clears it rather
// than silently ignoring it — the backend only accepts campaignId on
// /google/ad-groups and parentId on /google/ads, /google/keywords and
// /google/search-terms (GoogleQuerySchema).
// ============================================================================
import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { ScopePeriodBar } from '@/features/_shared/ScopePeriodBar';
import { AdReportTabs, useAdReportTab, type AdReportTab } from '../../_shared/AdReportTabs';
import { useGoogleCampaigns, useGoogleAdGroups } from '../hooks';
import { GoogleCampaignsTab } from './GoogleCampaignsTab';
import { GoogleAdGroupsTab } from './GoogleAdGroupsTab';
import { GoogleAdsTab } from './GoogleAdsTab';
import { GoogleKeywordsTab } from './GoogleKeywordsTab';
import { GoogleSearchTermsTab } from './GoogleSearchTermsTab';
import { GooglePerformancePanel } from './GooglePerformancePanel';

const TABS: AdReportTab[] = [
  { id: 'campaigns', label: 'Campaigns' },
  { id: 'adgroups', label: 'Ad groups' },
  { id: 'ads', label: 'Ads' },
  { id: 'keywords', label: 'Keywords' },
  { id: 'searchterms', label: 'Search terms' },
];

// Which URL filter param each tab can actually honour. Ads, Keywords and
// Search terms all share `parentId` — an ad group's id — because all three are
// reports ABOUT an ad group rather than levels beneath one another.
const FILTER_PARAM: Record<string, 'campaignId' | 'parentId' | null> = {
  campaigns: null,
  adgroups: 'campaignId',
  ads: 'parentId',
  keywords: 'parentId',
  searchterms: 'parentId',
};

function FilterChip({ label, onDismiss }: { label: string; onDismiss: () => void }) {
  return (
    <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-[12px] text-brand-700">
      {label}
      <button
        type="button"
        onClick={onDismiss}
        aria-label={`Clear filter: ${label}`}
        className="leading-none text-brand-700/60 transition-colors hover:text-brand-700"
      >
        ×
      </button>
    </span>
  );
}

export default function GoogleReportScreen() {
  const [tab, setTab] = useAdReportTab(TABS);
  // Owned HERE, not by either consumer, because two of them read it: the
  // summary rail and the campaign table one tab down. Off (the default) is the
  // owner's own CPB/CPA definition — new patients only; on counts every match.
  // Both figures come from ONE already-cached response, so flipping it costs
  // no request; what it must not do is move the rail's definition of an
  // accepted patient while the campaign table below keeps the other one.
  const [includeExisting, setIncludeExisting] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const campaignId = params.get('campaignId');
  const parentId = params.get('parentId');

  // A tab that cannot honour the current filter clears it rather than silently
  // ignoring it. Deliberately keyed on `tab` alone: this must NOT re-run just
  // because scope/period params changed.
  useEffect(() => {
    const keep = FILTER_PARAM[tab];
    const sp = new URLSearchParams(params.toString());
    let changed = false;
    if (keep !== 'campaignId' && sp.has('campaignId')) { sp.delete('campaignId'); changed = true; }
    if (keep !== 'parentId' && sp.has('parentId')) { sp.delete('parentId'); changed = true; }
    if (changed) router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // new URLSearchParams(params.toString()) preserves every OTHER param —
  // scope, mode, mk/yk/cs/cu — the same way scope-context's own setters do.
  const filterByCampaign = useCallback((id: string) => {
    const sp = new URLSearchParams(params.toString());
    sp.set('tab', 'adgroups');
    sp.set('campaignId', id);
    sp.delete('parentId');
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
  }, [params, pathname, router]);

  const clearFilter = useCallback((key: 'campaignId' | 'parentId') => {
    const sp = new URLSearchParams(params.toString());
    sp.delete(key);
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
  }, [params, pathname, router]);

  // Lifted above the tab that owns them: useGoogleCampaigns feeds the
  // Campaigns tab AND resolves the human-readable name behind the campaignId
  // chip; useGoogleAdGroups feeds the Ad groups tab AND resolves the ad-group
  // name behind the parentId chip on the three tabs that take one. React Query
  // dedupes an identical queryKey, so each is ONE request.
  const campaigns = useGoogleCampaigns();
  const adGroups = useGoogleAdGroups(campaignId);

  const campaignName = campaignId
    ? (campaigns.data?.rows.find((r) => r.id === campaignId)?.name ?? null)
    : null;
  const adGroupName = parentId
    ? (adGroups.data?.rows.find((r) => r.id === parentId)?.name ?? null)
    : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Google"
        subtitle="What the spend bought — from the campaign down to the words people typed."
      />
      {/* Scoped to practices with a mapped Google Ads account. One without an
          account can only ever render £0, which reads as "we spent nothing
          here" rather than "this practice is not connected". */}
      <ScopePeriodBar adProvider="google_ads" />

      {/* Above the tab strip on purpose: group totals and the per-practice
          split are true regardless of which grain tab is open, and a practice
          is not a level of the campaign hierarchy — it is a different axis.
          Anything with a campaign grain lives in the tabs below. */}
      <GooglePerformancePanel
        includeExisting={includeExisting}
        onIncludeExistingChange={setIncludeExisting}
      />

      <div className="flex flex-col gap-4">
        <AdReportTabs tabs={TABS} active={tab} onChange={setTab} />

        {tab === 'adgroups' && campaignId && (
          <FilterChip
            label={`Campaign: ${campaignName ?? campaignId}`}
            onDismiss={() => clearFilter('campaignId')}
          />
        )}
        {(tab === 'ads' || tab === 'keywords' || tab === 'searchterms') && parentId && (
          <FilterChip
            label={`Ad group: ${adGroupName ?? parentId}`}
            onDismiss={() => clearFilter('parentId')}
          />
        )}

        {tab === 'campaigns' && (
          <GoogleCampaignsTab
            query={campaigns}
            includeExisting={includeExisting}
            onSelectCampaign={filterByCampaign}
          />
        )}
        {tab === 'adgroups' && <GoogleAdGroupsTab query={adGroups} />}
        {tab === 'ads' && <GoogleAdsTab parentId={parentId} />}
        {tab === 'keywords' && <GoogleKeywordsTab parentId={parentId} />}
        {tab === 'searchterms' && <GoogleSearchTermsTab parentId={parentId} />}
      </div>
    </div>
  );
}
