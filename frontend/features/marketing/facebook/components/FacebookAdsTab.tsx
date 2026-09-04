'use client';
// Facebook report — Ads tab. The old FacebookAdRows (deleted, Task 3)
// rendered these rows expanded in place beneath an Ad-sets row, paginated
// via a "Show more ads" button inside that table's own <tbody>. That
// pagination survives here as the same useInfiniteQuery — only the location
// changed: this is now a first-class tab, filtered by `adSetId` from the URL
// instead of always scoped to whichever row was expanded.
//
// ads() (backend/src/services/facebook-report.service.js) returns ONLY
// { rows, nextCursor, effectiveSince, windowClamped } — no state, no
// coverage, no notIdentified/unmatchedLeads bucket. That was fine when this
// data only ever rendered nested under an Ad-sets row whose OWN state notice
// already explained an empty result; as a first-class tab it can be the very
// first thing a tenant with no Meta connection lands on, and an empty table
// with no explanation would fail "a tab showing an empty table must say
// why". `orgState` — the Campaigns tab's organisation-wide state, threaded
// down from FacebookReportScreen (same lifted query, no extra request) —
// fills that gap.
//
// Only not_connected/never_synced are borrowed, not the full FacebookState:
// both imply zero ad_metrics rows exist at all, so an empty ad-grain table
// has the same cause. no_spend_in_window/no_ad_id_coverage are measured over
// leads-to-campaign attribution — a question this grain's spend rows do not
// depend on — so borrowing those would tell a tenant their ad spend is
// missing when it is really their lead-to-ad-id coverage that is.
//
// No campaign-level filter chain either: campaignId cannot reach this
// endpoint (FacebookQuerySchema only accepts adSetId here) — see
// FacebookReportScreen's FILTER_PARAM table, which clears campaignId the
// moment this tab becomes active rather than silently ignoring it.
import { EmptyState, SkeletonTable } from '@/components/ui';
import { DeferUntilVisible } from '@/components/DeferUntilVisible';
import { formatDate } from '@/lib/format';
import { AdMetricTable, type Column } from '../../_shared/AdMetricTable';
import { money, ctr, num } from '../../_shared/format';
import { FacebookStateNotice } from './FacebookStateNotice';
import { useFacebookAds } from '../hooks';
import type { FacebookRow, FacebookState } from '../api';

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
  orgState,
}: {
  /** The active ad-set filter, or null when this tab is listing every ad in
   *  the window unfiltered. */
  adSetId: string | null;
  /** The Campaigns tab's own state — see file header for why only two of its
   *  five values are borrowed here. undefined while that query is loading. */
  orgState: FacebookState | undefined;
}) {
  const {
    data, isLoading, isError, error, hasNextPage, isFetchingNextPage, fetchNextPage,
  } = useFacebookAds(adSetId);

  if (isError) {
    return <EmptyState message={`Couldn't load ads: ${(error as Error)?.message ?? 'unknown error'}`} />;
  }
  if (isLoading && !data) return <SkeletonTable rows={8} cols={13} />;
  if (!data) return null;

  const rows = data.pages.flatMap((p) => p.rows);
  const firstPage = data.pages[0];
  const notice = orgState === 'not_connected' || orgState === 'never_synced' ? orgState : null;

  return (
    <div className="flex flex-col gap-4">
      {notice ? (
        <FacebookStateNotice state={notice} coverage={null} scope="organisation" />
      ) : (
        <>
          {firstPage.windowClamped && (
            <Note>
              Ad set and ad detail is kept for 92 days. This period reaches further back
              than that, so figures below are shown from {formatDate(firstPage.effectiveSince)}
              {' '}onward rather than the whole period.
            </Note>
          )}

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
        </>
      )}
    </div>
  );
}
