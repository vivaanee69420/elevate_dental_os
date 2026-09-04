'use client';
// Google report — one page, FOUR tabs (Campaigns / Ad groups / Ads /
// Keywords), the Google analogue of
// ../facebook/components/FacebookReportScreen.tsx. Four rather than three
// because Google's hierarchy is Campaign -> Ad Group -> { Ads, Keywords } —
// ads and keywords are SIBLINGS under an ad group, so neither is nested
// inside the other's tab.
//
// Two queries are lifted to this top level, ABOVE the tab that "owns" them —
// same idiom as the Facebook screen, same reason:
//
//  - useGoogleCampaigns(): needed by the Campaigns tab for its own table,
//    and to resolve the human-readable campaign name behind the
//    `campaignId` filter chip shown on the Ad groups tab.
//  - useGoogleAdGroups(campaignId): needed by the Ad groups tab for its own
//    table, and to resolve the ad-group name behind the `parentId` filter
//    chip shown on the Ads AND Keywords tabs (both take the same filter —
//    ads and keywords are siblings, not parent/child).
//
// Lifting them here means each is ONE request (react-query dedupes an
// identical queryKey), not a second copy fired from whichever tab happens to
// need the name.
//
// Filter chain: clicking a campaign row (Campaigns tab) sets `campaignId`
// and switches to Ad groups; clicking an ad-group row (Ad groups tab) sets
// `parentId` and switches to Ads — and that SAME `parentId` filter applies
// on the Keywords tab too, so switching between Ads and Keywords keeps the
// chip and the filter (unlike switching to/from Ad groups, which drops it).
// Both filters live in the URL beside `tab`, so the view is shareable and
// the back button works. A tab that cannot honour the current filter clears
// it rather than silently ignoring it (FILTER_PARAM below + the effect that
// enforces it) — the backend only accepts campaignId on /google/ad-groups
// and parentId on /google/ads + /google/keywords (GoogleQuerySchema).
import { useCallback, useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { ScopePeriodBar } from '@/features/_shared/ScopePeriodBar';
import { AdReportTabs, useAdReportTab, type AdReportTab } from '../../_shared/AdReportTabs';
import { useGoogleCampaigns, useGoogleAdGroups } from '../hooks';
import { GoogleCampaignsTab } from './GoogleCampaignsTab';
import { GoogleAdGroupsTab } from './GoogleAdGroupsTab';
import { GoogleAdsTab } from './GoogleAdsTab';
import { GoogleKeywordsTab } from './GoogleKeywordsTab';

const TABS: AdReportTab[] = [
  { id: 'campaigns', label: 'Campaigns' },
  { id: 'adgroups', label: 'Ad groups' },
  { id: 'ads', label: 'Ads' },
  { id: 'keywords', label: 'Keywords' },
];

// Which URL filter param each tab can actually honour. Ads and Keywords
// share `parentId` — the one deliberate difference from the Facebook
// screen's FILTER_PARAM, where each tab owns a distinct param.
const FILTER_PARAM: Record<string, 'campaignId' | 'parentId' | null> = {
  campaigns: null,
  adgroups: 'campaignId',
  ads: 'parentId',
  keywords: 'parentId',
};

function FilterChip({ label, onDismiss }: { label: string; onDismiss: () => void }) {
  return (
    <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-border bg-bg px-3 py-1 text-[12.5px] text-ink">
      {label}
      <button
        type="button"
        onClick={onDismiss}
        aria-label={`Clear filter: ${label}`}
        className="leading-none text-ink-muted hover:text-ink"
      >
        ×
      </button>
    </span>
  );
}

export default function GoogleReportScreen() {
  const [tab, setTab] = useAdReportTab(TABS);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const campaignId = params.get('campaignId');
  const parentId = params.get('parentId');

  // A tab that cannot honour the current filter clears it rather than
  // silently ignoring it. Runs on mount and whenever the active tab changes
  // (including the tab strip's own self-correction of an unrecognised
  // ?tab=, via useAdReportTab's effect). Deliberately keyed on `tab` alone:
  // this must NOT re-run just because scope/period params changed.
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
  // scope, mode, mk/yk/cs/cu (features/_shared/scope-context.tsx) — the same
  // way that context's own setScope/setMode do.
  const filterByCampaign = useCallback((id: string) => {
    const sp = new URLSearchParams(params.toString());
    sp.set('tab', 'adgroups');
    sp.set('campaignId', id);
    sp.delete('parentId');
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
  }, [params, pathname, router]);

  const filterByAdGroup = useCallback((id: string) => {
    const sp = new URLSearchParams(params.toString());
    sp.set('tab', 'ads');
    sp.set('parentId', id);
    sp.delete('campaignId');
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
  }, [params, pathname, router]);

  const clearFilter = useCallback((key: 'campaignId' | 'parentId') => {
    const sp = new URLSearchParams(params.toString());
    sp.delete(key);
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
  }, [params, pathname, router]);

  // Lifted so both can be shared with the Ads/Keywords tabs — see file header.
  const campaigns = useGoogleCampaigns();
  const adGroups = useGoogleAdGroups(campaignId);

  const campaignName = campaignId
    ? (campaigns.data?.rows.find((r) => r.id === campaignId)?.name ?? null)
    : null;
  const adGroupName = parentId
    ? (adGroups.data?.rows.find((r) => r.id === parentId)?.name ?? null)
    : null;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Google"
        subtitle="Google Ads performance, from spend down to Google's own tracked conversions."
      />
      <ScopePeriodBar />

      <AdReportTabs tabs={TABS} active={tab} onChange={setTab} />

      {tab === 'adgroups' && campaignId && (
        <FilterChip
          label={`Campaign: ${campaignName ?? campaignId}`}
          onDismiss={() => clearFilter('campaignId')}
        />
      )}
      {(tab === 'ads' || tab === 'keywords') && parentId && (
        <FilterChip
          label={`Ad group: ${adGroupName ?? parentId}`}
          onDismiss={() => clearFilter('parentId')}
        />
      )}

      {tab === 'campaigns' && (
        <GoogleCampaignsTab query={campaigns} onSelectCampaign={filterByCampaign} />
      )}
      {tab === 'adgroups' && (
        <GoogleAdGroupsTab query={adGroups} onSelectAdGroup={filterByAdGroup} />
      )}
      {tab === 'ads' && <GoogleAdsTab parentId={parentId} />}
      {tab === 'keywords' && <GoogleKeywordsTab parentId={parentId} />}
    </div>
  );
}
