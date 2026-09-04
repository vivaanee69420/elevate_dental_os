'use client';
// Google report — Ads tab. The SIBLING of the Keywords tab under an ad group
// (google-report.service.js's file header) — neither contains the other, so
// this file and GoogleKeywordsTab.tsx both take the SAME `parentId` (an ad
// group id) rather than one nesting inside the other.
//
// Like ../facebook/components/FacebookAdsTab.tsx, this tab needs NO
// `orgState` prop borrowed from the Campaigns tab: ads() returns its own
// `state`, so an empty table can say why from its own data (see
// google-report.service.js's file header, point 3).
import { EmptyState, SkeletonTable } from '@/components/ui';
import { DeferUntilVisible } from '@/components/DeferUntilVisible';
import { formatDate } from '@/lib/format';
import { AdMetricTable, type Column } from '../../_shared/AdMetricTable';
import { money, ctr, num } from '../../_shared/format';
import { GoogleStateNotice } from './GoogleStateNotice';
import { useGoogleAds } from '../hooks';
import type { GoogleRow } from '../api';

// Calm, factual prose — never an error/warning colour.
function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-panel border border-border bg-bg px-3 py-2 text-[12.5px] leading-relaxed text-ink-muted">
      {children}
    </p>
  );
}

// Name, Spend, Impressions, Clicks, CTR, CPC, Conversions, Cost / conversion
// — no CPL/CPB/CPA-shaped columns anywhere on this page (see
// google-report.service.js's file header, point 5): those need CallRail
// calls and GoHighLevel leads deduplicated to one person, a separate plan.
const COLUMNS: Column<GoogleRow>[] = [
  {
    key: 'name',
    header: 'Ad',
    align: 'left',
    render: (r) => (
      <span className="font-medium text-brand">
        {r.name ?? r.id ?? 'Unnamed ad'}
        {r.campaignName && (
          <span className="block text-[11px] font-normal text-ink-muted">{r.campaignName}</span>
        )}
      </span>
    ),
  },
  { key: 'spend', header: 'Spend', align: 'right', render: (r) => money(r.spendPence) },
  { key: 'impressions', header: 'Impressions', align: 'right', render: (r) => num(r.impressions) },
  { key: 'clicks', header: 'Clicks', align: 'right', render: (r) => num(r.clicks) },
  { key: 'ctr', header: 'CTR', align: 'right', render: (r) => ctr(r.ctr) },
  { key: 'cpc', header: 'CPC', align: 'right', render: (r) => money(r.cpcPence) },
  { key: 'conversions', header: 'Conversions', align: 'right', render: (r) => num(r.conversions) },
  { key: 'costPerConversion', header: 'Cost / conversion', align: 'right', render: (r) => money(r.costPerConversionPence) },
];

export function GoogleAdsTab({ parentId }: {
  /** The active ad-group filter, or null when this tab is listing every ad
   *  in the window unfiltered. */
  parentId: string | null;
}) {
  const {
    data, isLoading, isError, error, hasNextPage, isFetchingNextPage, fetchNextPage,
  } = useGoogleAds(parentId);

  if (isError) {
    return <EmptyState message={`Couldn't load ads: ${(error as Error)?.message ?? 'unknown error'}`} />;
  }
  if (isLoading && !data) return <SkeletonTable rows={8} cols={8} />;
  if (!data) return null;

  const rows = data.pages.flatMap((p) => p.rows);
  const firstPage = data.pages[0];
  const showTable = firstPage.state === 'ok';

  return (
    <div className="flex flex-col gap-4">
      <GoogleStateNotice state={firstPage.state} />

      {showTable && (
        <>
          {firstPage.windowClamped && (
            <Note>
              Ad group, ad and keyword detail is kept for 92 days. This period reaches further back
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

      {firstPage.excludedAccounts.length > 0 && (
        <Note>
          {firstPage.excludedAccounts.length === 1
            ? 'One Google account is'
            : `${firstPage.excludedAccounts.length} Google accounts are`}
          {' '}not shown here because Elevate does not yet report in{' '}
          {firstPage.excludedAccounts.length === 1 ? 'its' : 'their'} currency:{' '}
          {firstPage.excludedAccounts.map((a, i) => (
            <span key={a.customerId}>
              {i > 0 ? ', ' : ''}
              {a.name ?? a.customerId}
              {a.currency ? ` (${a.currency})` : ''}
            </span>
          ))}
          .
        </Note>
      )}
    </div>
  );
}
