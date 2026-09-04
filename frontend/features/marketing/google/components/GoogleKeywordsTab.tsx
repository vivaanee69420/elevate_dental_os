'use client';
// Google report — Keywords tab. The SIBLING of the Ads tab under an ad group
// (see GoogleAdsTab.tsx's header) — takes the SAME `parentId` filter, not a
// nested one.
//
// Two extra columns' worth of figures here are approximations, and the two
// statements the service returns (google-report.service.js's APPROXIMATE)
// are printed as Notes directly above the table that carries the columns
// they describe — NOT buried in a page footer — so a reader sees the caveat
// before the Quality Score / impression-share numbers themselves.
import { EmptyState, SkeletonTable } from '@/components/ui';
import { DeferUntilVisible } from '@/components/DeferUntilVisible';
import { formatDate } from '@/lib/format';
import { AdMetricTable, type Column } from '../../_shared/AdMetricTable';
import { money, ctr, num, DASH } from '../../_shared/format';
import { GoogleStateNotice } from './GoogleStateNotice';
import { useGoogleKeywords } from '../hooks';
import type { GoogleKeywordRow } from '../api';

// Calm, factual prose — never an error/warning colour.
function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-panel border border-border bg-bg px-3 py-2 text-[12.5px] leading-relaxed text-ink-muted">
      {children}
    </p>
  );
}

// EXACT/PHRASE/BROAD from Google, title-cased for a British UI rather than
// shouted back in Google's enum casing — same treatment as the campaign
// status chip.
function matchTypeLabel(matchType: string | null): string {
  if (!matchType) return DASH;
  return matchType.charAt(0).toUpperCase() + matchType.slice(1).toLowerCase();
}

// Name, Spend, Impressions, Clicks, CTR, CPC, Conversions, Cost / conversion,
// then the keyword-only columns: Match type, Quality Score, and the three
// impression-share ratios (reusing `ctr()` — it is the same "0-1 fraction to
// one decimal-place percentage" transform, scaled exactly once, here).
const COLUMNS: Column<GoogleKeywordRow>[] = [
  {
    key: 'name',
    header: 'Keyword',
    align: 'left',
    render: (r) => (
      <span className="font-medium text-brand">
        {r.name ?? r.id ?? 'Unnamed keyword'}
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
  { key: 'matchType', header: 'Match type', align: 'left', render: (r) => matchTypeLabel(r.matchType) },
  { key: 'qualityScore', header: 'Quality Score', align: 'right', render: (r) => num(r.qualityScore) },
  { key: 'impressionShare', header: 'Impr. share', align: 'right', render: (r) => ctr(r.searchImpressionShare) },
  { key: 'topImpressionShare', header: 'Top impr. share', align: 'right', render: (r) => ctr(r.searchTopImpressionShare) },
  { key: 'absTopImpressionShare', header: 'Abs. top impr. share', align: 'right', render: (r) => ctr(r.searchAbsoluteTopImpressionShare) },
];

export function GoogleKeywordsTab({ parentId }: {
  /** The active ad-group filter, or null when this tab is listing every
   *  keyword in the window unfiltered. */
  parentId: string | null;
}) {
  const {
    data, isLoading, isError, error, hasNextPage, isFetchingNextPage, fetchNextPage,
  } = useGoogleKeywords(parentId);

  if (isError) {
    return <EmptyState message={`Couldn't load keywords: ${(error as Error)?.message ?? 'unknown error'}`} />;
  }
  if (isLoading && !data) return <SkeletonTable rows={8} cols={13} />;
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

          <Note>{firstPage.approximate.impressionShare}</Note>
          <Note>{firstPage.approximate.qualityScore}</Note>

          <DeferUntilVisible minHeight={360}>
            <AdMetricTable
              columns={COLUMNS}
              rows={rows}
              emptyState={<EmptyState message="No keywords with spend in this window." />}
            />
            {hasNextPage && (
              <div className="mt-3 flex justify-center">
                <button
                  type="button"
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                  className="rounded-lg border border-border bg-surface px-4 py-1.5 text-[12.5px] text-ink-muted hover:bg-bg disabled:opacity-50"
                >
                  {isFetchingNextPage ? 'Loading…' : 'Show more keywords'}
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
