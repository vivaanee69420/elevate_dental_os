'use client';
// Facebook report — one page, three tabs (Campaigns / Ad sets / Ads), plus a
// fourth (Open days) shown only to tenants that map campaigns to at least one
// event — see hasOpenDays below. Replacing the old two-route drill-down (a
// campaign list, then
// /marketing-facebook/[campaignId] listing that campaign's ad sets with ads
// expanding in place — both deleted, Task 3). The owner asked for tabs
// ("1 facebook page and 3 tabs inside it for campaigns, ads and ad sets"),
// and shipping the drill-down alongside a tabbed Google Ads report would
// have left two ad-reporting pages with different interaction models.
//
// Two queries are lifted to this top level, ABOVE the tab that "owns" them,
// deliberately:
//
//  - useFacebookCampaigns(): needed by the Campaigns tab for its own table,
//    and to resolve the human-readable campaign name behind the
//    `campaignId` filter chip shown on the Ad sets tab.
//  - useFacebookAdSets(campaignId): needed by the Ad sets tab for its own
//    table, but ALSO by the Ads tab, to resolve the human-readable ad-set
//    name behind the `adSetId` filter chip. (The Ads tab's own state/
//    coverage notice comes from ads() itself now — see FacebookAdsTab's
//    header comment — not from either of these.)
//
// Lifting them here means both are ONE request each (react-query dedupes an
// identical queryKey) rather than a second copy fired from inside whichever
// tab happens to need the name — the exact "reuse the call the app already
// made" idiom the old AdSetsScreen used for its campaign name.
//
// Filter chain: clicking a campaign row (Campaigns tab) sets `campaignId`
// and switches to Ad sets; clicking an ad-set row (Ad sets tab) sets
// `adSetId` and switches to Ads. Both filters live in the URL beside `tab`
// (owned by the shared useAdReportTab hook), so the view is shareable and
// the back button works — matching the campaign name/window/practice/period
// idiom every other query param on this page already follows. A tab that
// cannot honour the current filter clears it rather than silently ignoring
// it (FILTER_PARAM below + the effect that enforces it) — the backend only
// accepts campaignId on /facebook/ad-sets and adSetId on /facebook/ads
// (Task 2's FacebookQuerySchema), there is no "filter ads by campaign".
import { useCallback, useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { ScopePeriodBar } from '@/features/_shared/ScopePeriodBar';
import { FacebookPerformancePanel } from './FacebookPerformancePanel';
import { AdReportTabs, useAdReportTab, type AdReportTab } from '../../_shared/AdReportTabs';
import { useFacebookCampaigns, useFacebookAdSets, useFacebookLeadPerformance } from '../hooks';
import { FacebookCampaignsTab } from './FacebookCampaignsTab';
import { FacebookAdSetsTab } from './FacebookAdSetsTab';
import { FacebookAdsTab } from './FacebookAdsTab';
import { FacebookOpenDaysTab } from './FacebookOpenDaysTab';

const BASE_TABS: AdReportTab[] = [
  { id: 'campaigns', label: 'Campaigns' },
  { id: 'adsets', label: 'Ad sets' },
  { id: 'ads', label: 'Ads' },
];

// Which URL filter param each tab can actually honour.
const FILTER_PARAM: Record<string, 'campaignId' | 'adSetId' | null> = {
  campaigns: null,
  adsets: 'campaignId',
  ads: 'adSetId',
  opendays: null,
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

export default function FacebookReportScreen() {
  const { data: perf, isPending: perfPending } = useFacebookLeadPerformance();
  // Only for tenants that actually run open days. Computed from this
  // tenant's own rows, never assumed — an always-empty tab is noise for
  // every tenant that doesn't map campaigns to events.
  const hasOpenDays = (perf?.openDays.events.length ?? 0) > 0;
  const TABS = hasOpenDays
    ? [...BASE_TABS, { id: 'opendays', label: 'Open days' }]
    : BASE_TABS;

  // The tab list is not final until `perf` lands, so the URL must not be
  // normalised before then: TABS lacks `opendays` on the first render, and
  // rewriting ?tab=opendays to ?tab=campaigns there made a bookmarked or
  // shared open-days link impossible to reload. Once the query settles the
  // rewrite resumes as before — so a tenant with no open days still never
  // sees the tab, and its URL is still corrected.
  const [tab, setTab] = useAdReportTab(TABS, { pending: perfPending });
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const campaignId = params.get('campaignId');
  const adSetId = params.get('adSetId');

  // A tab that cannot honour the current filter clears it rather than
  // silently ignoring it — the URL must never claim a filter that isn't
  // actually applied. Runs on mount and whenever the active tab changes
  // (including the tab strip's own self-correction of an unrecognised
  // ?tab=, via useAdReportTab's effect). Deliberately keyed on `tab` alone:
  // this must NOT re-run just because scope/period params changed.
  useEffect(() => {
    const keep = FILTER_PARAM[tab];
    const sp = new URLSearchParams(params.toString());
    let changed = false;
    if (keep !== 'campaignId' && sp.has('campaignId')) { sp.delete('campaignId'); changed = true; }
    if (keep !== 'adSetId' && sp.has('adSetId')) { sp.delete('adSetId'); changed = true; }
    if (changed) router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // new URLSearchParams(params.toString()) preserves every OTHER param —
  // scope, mode, mk/yk/cs/cu (features/_shared/scope-context.tsx) — the same
  // way that context's own setScope/setMode do. Building sp from scratch
  // instead would silently reset the practice/period selection on every
  // filter click.
  const filterByCampaign = useCallback((id: string) => {
    const sp = new URLSearchParams(params.toString());
    sp.set('tab', 'adsets');
    sp.set('campaignId', id);
    sp.delete('adSetId');
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
  }, [params, pathname, router]);

  const filterByAdSet = useCallback((id: string) => {
    const sp = new URLSearchParams(params.toString());
    sp.set('tab', 'ads');
    sp.set('adSetId', id);
    sp.delete('campaignId');
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
  }, [params, pathname, router]);

  const clearFilter = useCallback((key: 'campaignId' | 'adSetId') => {
    const sp = new URLSearchParams(params.toString());
    sp.delete(key);
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
  }, [params, pathname, router]);

  // Lifted so both can be shared with the Ads tab — see file header.
  const campaigns = useFacebookCampaigns();
  const adSets = useFacebookAdSets(campaignId);

  const campaignName = campaignId
    ? (campaigns.data?.rows.find((r) => r.id === campaignId)?.name ?? null)
    : null;
  const adSetName = adSetId
    ? (adSets.data?.rows.find((r) => r.id === adSetId)?.name ?? null)
    : null;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Facebook"
        subtitle="Meta ad performance, from spend down to the patient it produced. Attendance is recorded in Dentally only."
      />
      {/* Scoped to practices with a mapped Meta account. One without an
          account can only ever render £0, which reads as "we spent nothing
          here" rather than "this practice is not connected". */}
      <ScopePeriodBar adProvider="meta_ads" />

      {/* Cost per lead / booking / acquired patient, on the same money-paid
          rule as the Google report (000167). Above the tabs because it is the
          figure to compare across platforms; the Campaigns tab's own patient
          count answers a narrower question. */}
      <FacebookPerformancePanel />

      <AdReportTabs tabs={TABS} active={tab} onChange={setTab} />

      {tab === 'adsets' && campaignId && (
        <FilterChip
          label={`Campaign: ${campaignName ?? campaignId}`}
          onDismiss={() => clearFilter('campaignId')}
        />
      )}
      {tab === 'ads' && adSetId && (
        <FilterChip
          label={`Ad set: ${adSetName ?? adSetId}`}
          onDismiss={() => clearFilter('adSetId')}
        />
      )}

      {tab === 'campaigns' && (
        <FacebookCampaignsTab query={campaigns} onSelectCampaign={filterByCampaign} />
      )}
      {tab === 'adsets' && (
        <FacebookAdSetsTab query={adSets} campaignId={campaignId} onSelectAdSet={filterByAdSet} />
      )}
      {tab === 'ads' && (
        <FacebookAdsTab adSetId={adSetId} />
      )}
      {tab === 'opendays' && <FacebookOpenDaysTab />}
    </div>
  );
}
