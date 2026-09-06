'use client';
// Facebook report — Ads tab. The old FacebookAdRows (deleted, Task 3)
// rendered these rows expanded in place beneath an Ad-sets row, paginated
// via a "Show more ads" button inside that table's own <tbody>. That
// pagination survives here as the same useInfiniteQuery — only the location
// changed: this is now a first-class tab, filtered by `adSetId` from the URL
// instead of always scoped to whichever row was expanded.
//
// ads() (backend/src/services/facebook-report.service.js) now computes its
// OWN state from THIS grain's own rows — the deep-grain ad rollup and ad_id
// resolution — the same way adSets() does for ad sets. It used to return
// only { rows, nextCursor, effectiveSince, windowClamped }, and this tab
// borrowed the Campaigns tab's state to explain an empty table; that read a
// different query answering a different question (ad_metrics' campaign-day
// rows and ad-SET coverage), so it could tell a tenant this tab was fine
// when the ad-level sync genuinely had nothing, or vice versa. See
// FacebookStateNotice for the six states.
//
// No campaign-level filter chain either: campaignId cannot reach this
// endpoint (FacebookQuerySchema only accepts adSetId here) — see
// FacebookReportScreen's FILTER_PARAM table, which clears campaignId the
// moment this tab becomes active rather than silently ignoring it.
import { EmptyState, SkeletonTable } from '@/components/ui';
import { DeferUntilVisible } from '@/components/DeferUntilVisible';
import { formatDate } from '@/lib/format';
import { useScopePeriod } from '@/features/_shared/scope-context';
import { AdMetricTable, type Column } from '../../_shared/AdMetricTable';
import { money, ctr, num } from '../../_shared/format';
import { FacebookStateNotice } from './FacebookStateNotice';
import { useFacebookAds } from '../hooks';
import type { FacebookRow, FacebookNoticeScope } from '../api';
import SpendFreshnessNote from '@/features/marketing/_shared/SpendFreshnessNote';

// Calm, factual prose — never an error/warning colour. These are facts about
// the data, not problems with it.
function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-panel border border-border bg-bg px-3 py-2 text-[12.5px] leading-relaxed text-ink-muted">
      {children}
    </p>
  );
}

// Name, Spend, Impressions, Clicks, CTR, CPC, Leads, Booked, Attended,
// Patients, CPL, CPB, CPA — the same 13 columns as every other tab, no
// platform-conversions column: Meta's `actions` are not requested at ad
// grain (ad_grain_rollup never returns them here), so the column would be a
// permanent zero. FacebookRow itself carries no such field, so there is
// nothing to accidentally render.
const COLUMNS: Column<FacebookRow>[] = [
  { key: 'name', header: 'Ad', align: 'left', render: (r) => r.name ?? r.id ?? 'Unnamed ad' },
  { key: 'spend', header: 'Spend', align: 'right', render: (r) => money(r.spendPence) },
  { key: 'impressions', header: 'Impressions', align: 'right', render: (r) => num(r.impressions) },
  { key: 'clicks', header: 'Clicks', align: 'right', render: (r) => num(r.clicks) },
  { key: 'ctr', header: 'CTR', align: 'right', render: (r) => ctr(r.ctr) },
  { key: 'cpc', header: 'CPC', align: 'right', render: (r) => money(r.cpcPence) },
  { key: 'leads', header: 'Leads', align: 'right', render: (r) => num(r.leads) },
  { key: 'booked', header: 'Booked', align: 'right', render: (r) => num(r.booked) },
  { key: 'attended', header: 'Attended*', align: 'right', render: (r) => num(r.attended) },
  { key: 'patients', header: 'Patients', align: 'right', render: (r) => num(r.patients) },
  { key: 'cpl', header: 'CPL', align: 'right', render: (r) => money(r.cplPence) },
  { key: 'cpb', header: 'CPB', align: 'right', render: (r) => money(r.cpbPence) },
  { key: 'cpa', header: 'CPA', align: 'right', render: (r) => money(r.cpaPence) },
];

export function FacebookAdsTab({
  adSetId,
}: {
  /** The active ad-set filter, or null when this tab is listing every ad in
   *  the window unfiltered. */
  adSetId: string | null;
}) {
  const {
    data, isLoading, isError, error, hasNextPage, isFetchingNextPage, fetchNextPage,
  } = useFacebookAds(adSetId);

  // What this payload's state was actually measured over: ONE ad set when a
  // filter is active, otherwise the same organisation/selection distinction
  // the Campaigns and Ad sets tabs make — same pattern as AdSetsTab's
  // noticeScope, one grain down.
  const { scope } = useScopePeriod();
  const noticeScope: FacebookNoticeScope = adSetId
    ? 'adset'
    : (scope && scope !== 'all' ? 'selection' : 'organisation');

  if (isError) {
    return <EmptyState message={`Couldn't load ads: ${(error as Error)?.message ?? 'unknown error'}`} />;
  }
  if (isLoading && !data) return <SkeletonTable rows={8} cols={13} />;
  if (!data) return null;

  const rows = data.pages.flatMap((p) => p.rows);
  const firstPage = data.pages[0];

  // Platform metrics stand on their own even without ad-id coverage; only
  // not_connected/never_synced/no_spend_in_window have nothing to show — and
  // by construction (see the service), rows are always empty in those three
  // states anyway, since the grain rollup itself was empty.
  const showTable = firstPage.state === 'ok' || firstPage.state === 'no_ad_id_coverage';

  return (
    <div className="flex flex-col gap-4">
      <FacebookStateNotice state={firstPage.state} coverage={null} scope={noticeScope} />

      <SpendFreshnessNote freshness={firstPage.freshness} />

      {firstPage.windowClamped && (
        <Note>
          Ad set and ad detail is kept for 92 days. This period reaches further back
          than that, so figures below are shown from {formatDate(firstPage.effectiveSince)}
          {' '}onward rather than the whole period.
        </Note>
      )}

      {showTable && (
        <DeferUntilVisible minHeight={360}>
          <AdMetricTable
            columns={COLUMNS}
            rows={rows}
            emptyState={<EmptyState message="No ads with spend in this window." />}
          />
          <p className="mt-2 text-[12px] text-ink-muted">
            * Attended is Dentally-only — a GoHighLevel booking alone cannot say whether
            someone turned up.
          </p>
          {hasNextPage && (
            <div className="mt-3 flex justify-center">
              <button
                type="button"
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                className="rounded-lg border border-border bg-surface px-4 py-1.5 text-[12.5px] text-ink-muted hover:bg-bg disabled:opacity-50"
              >
                {isFetchingNextPage ? 'Loading…' : 'Show more ads'}
              </button>
            </div>
          )}
        </DeferUntilVisible>
      )}
    </div>
  );
}
