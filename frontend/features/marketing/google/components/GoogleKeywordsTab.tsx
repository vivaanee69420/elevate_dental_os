'use client';
// Google report — Keywords tab. The SIBLING of the Ads tab under an ad group,
// so it takes the SAME `parentId` (an ad group id).
//
// TWO FIGURES HERE ARE APPROXIMATIONS AND THE PAGE SAYS SO, because saying so
// is the point:
//
//   * Impression share (and its top / absolute-top variants) is an
//     IMPRESSION-WEIGHTED AVERAGE across the window, with the denominator
//     filtered in SQL to the days Google actually reported a share. Google
//     computes its own range figure from ELIGIBLE impressions, which the API
//     does not expose, so ours can differ slightly.
//   * Quality Score is the LATEST value in the window, not an average — it is
//     a 1-10 grade, and averaging grades is meaningless.
//
// Spend, clicks, impressions and conversions are exact.
import { EmptyState } from '@/components/ui';
import { DeferUntilVisible } from '@/components/DeferUntilVisible';
import { DataGrid, type GridColumn } from '../../_shared/DataGrid';
import { SectionHead, FootNote } from '../../_shared/StatRail';
import { Chip, humanise } from '../../_shared/Bars';
import { num, DASH } from '../../_shared/format';
import { nameColumn, deliveryColumns, impressionShareColumn } from './columns';
import { GoogleTabFrame, ShowMore } from './GoogleTabFrame';
import { useGoogleKeywords } from '../hooks';
import type { GoogleKeywordRow } from '../api';

// Google's 1-10 grade. Coloured only at the ends, where the grade IS a
// judgement Google itself is making — a 4 means "this keyword is expensive
// because Google thinks it is a poor match", which is worth seeing without
// reading the number.
function qualityTone(score: number | null): 'neutral' | 'good' | 'bad' | 'muted' {
  if (score === null) return 'muted';
  if (score >= 8) return 'good';
  if (score <= 4) return 'bad';
  return 'neutral';
}

export function GoogleKeywordsTab({ parentId }: { parentId: string | null }) {
  const {
    data, isLoading, isError, error, hasNextPage, fetchNextPage, isFetchingNextPage,
  } = useGoogleKeywords(parentId);

  const first = data?.pages[0];
  const rows = data?.pages.flatMap((p) => p.rows) ?? [];
  const maxSpend = rows.reduce((m, r) => Math.max(m, r.spendPence), 0);

  const columns: GridColumn<GoogleKeywordRow>[] = [
    {
      ...nameColumn<GoogleKeywordRow>('Keyword', maxSpend, ''),
      // Match type belongs against the keyword text, not in a column of its
      // own: "dental implants" on broad and "dental implants" on exact are
      // two different keywords that read as one without it, and the reader is
      // already looking at the text when they need to know.
      sub: (r) => (
        <span className="flex items-center gap-2">
          {r.matchType && <Chip>{humanise(r.matchType)}</Chip>}
          {(r.campaignName || r.parentName) && (
            <span className="min-w-0 truncate">
              {[r.campaignName, r.parentName].filter(Boolean).join(' · ')}
            </span>
          )}
        </span>
      ),
    },
    ...deliveryColumns<GoogleKeywordRow>(),
    {
      key: 'quality', header: 'Quality', align: 'right', width: 'w-[90px]',
      sortBy: (r) => r.qualityScore,
      render: (r) => (r.qualityScore === null
        ? DASH
        : <Chip tone={qualityTone(r.qualityScore)}>{r.qualityScore}/10</Chip>),
    },
    impressionShareColumn<GoogleKeywordRow>(),
  ];

  return (
    <GoogleTabFrame
      state={first?.state}
      isLoading={isLoading}
      isError={isError}
      errorLabel={`Couldn't load keywords: ${(error as Error)?.message ?? 'unknown error'}`}
      windowClamped={first?.windowClamped}
      effectiveSince={first?.effectiveSince}
      excludedAccounts={first?.excludedAccounts}
      footer={(
        <>
          <ShowMore
            hasNext={Boolean(hasNextPage)}
            isFetching={isFetchingNextPage}
            onClick={() => fetchNextPage()}
            label="Show more keywords"
          />
          {first?.state === 'ok' && first.approximate && (
            <FootNote>
              Impression share: {first.approximate.impressionShare} Quality Score:{' '}
              {first.approximate.qualityScore}
            </FootNote>
          )}
        </>
      )}
    >
      <div className="flex flex-col gap-2">
        <SectionHead
          title="Keywords"
          note="What you bid on. What people actually typed is on the Search terms tab."
          right={<span className="text-[12px] text-ink-muted">{num(rows.length)} shown</span>}
        />
        <DeferUntilVisible minHeight={360}>
          <DataGrid
            columns={columns}
            rows={rows}
            rowKey={(r) => `${r.id}-${r.parentId ?? ''}`}
            emptyState={<EmptyState message="No keywords with spend in this window." />}
            rowTone={(r) => (r.spendPence > 0 ? 'default' : 'muted')}
          />
        </DeferUntilVisible>
      </div>
    </GoogleTabFrame>
  );
}
