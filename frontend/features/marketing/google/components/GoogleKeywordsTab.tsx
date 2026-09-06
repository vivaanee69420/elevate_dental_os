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
import { useState } from 'react';
import { EmptyState } from '@/components/ui';
import { DeferUntilVisible } from '@/components/DeferUntilVisible';
import { DataGrid, type GridColumn } from '../../_shared/DataGrid';
import { SectionHead, FootNote } from '../../_shared/StatRail';
import { Chip, humanise, ImpressionShareBar } from '../../_shared/Bars';
import { money, money0, num, ctr, pct, conversions as fmtConversions, DASH } from '../../_shared/format';
import { nameColumn, deliveryColumns, impressionShareColumn } from './columns';
import { BestPerformer, bestByCostPerConversion, unrankedNote } from '../../_shared/BestPerformer';
import { DetailModal, Facts } from '../../_shared/DetailModal';
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

  const [selected, setSelected] = useState<GoogleKeywordRow | null>(null);
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
      freshness={first?.freshness}
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
      <div className="flex flex-col gap-4">
        {/* Quality Score rides along as `extra` rather than as the ranking:
            it is Google's opinion of the keyword, not a result, and a 10/10
            keyword nobody converts on is not the best keyword. */}
        <BestPerformer
          onOpen={() => {
            const best = bestByCostPerConversion(rows.map((r) => ({
              id: r.id, name: r.name, spendPence: r.spendPence,
              conversions: r.conversions, costPerConversionPence: r.costPerConversionPence,
            })));
            setSelected(rows.find((r) => r.id === best?.id) ?? null);
          }}
          label="Best keyword"
          row={bestByCostPerConversion(rows.map((r) => ({
            id: r.id, name: r.name, spendPence: r.spendPence,
            conversions: r.conversions, costPerConversionPence: r.costPerConversionPence,
          })))}
          fallbackName="Unnamed keyword"
          extra={(() => {
            const best = bestByCostPerConversion(rows.map((r) => ({
              id: r.id, name: r.name, spendPence: r.spendPence,
              conversions: r.conversions, costPerConversionPence: r.costPerConversionPence,
            })));
            const full = best ? rows.find((r) => r.id === best.id) : null;
            return full?.qualityScore == null ? null : `quality ${full.qualityScore}/10`;
          })()}
        />
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
            onRowClick={setSelected}
          />
        </DeferUntilVisible>
      </div>

      <DetailModal
        open={selected !== null}
        title={selected?.name ?? selected?.id ?? 'Keyword'}
        subtitle={selected && [selected.matchType ? humanise(selected.matchType) : null,
          selected.campaignName, selected.parentName].filter(Boolean).join(' · ')}
        onClose={() => setSelected(null)}
      >
        {selected && (
          <div className="flex flex-col gap-4">
            <Facts items={[
              { label: 'Spend', value: money0(selected.spendPence),
                note: selected.cpcPence === null ? undefined : `${money(selected.cpcPence)} / click` },
              { label: 'Impressions', value: num(selected.impressions),
                note: `${num(selected.clicks)} clicks · ${ctr(selected.ctr)}` },
              { label: 'Conversions', value: fmtConversions(selected.conversions),
                note: selected.costPerConversionPence === null
                  ? undefined : `${money(selected.costPerConversionPence)} each` },
              { label: 'Quality score',
                value: selected.qualityScore === null ? DASH : `${selected.qualityScore}/10`,
                note: 'latest in the window, not an average' },
              { label: 'Top of page',
                value: pct(selected.searchTopImpressionShare),
                note: `absolute top ${pct(selected.searchAbsoluteTopImpressionShare)}` },
            ]}
            />
            <div>
              <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-ink-muted">
                Impression share
              </p>
              <ImpressionShareBar
                won={selected.searchImpressionShare}
                lostToBudget={selected.searchBudgetLostImpressionShare}
                lostToRank={selected.searchRankLostImpressionShare}
              />
            </div>
            {/* Restated in the dialog, not only in the footnote under the
                table: someone who opened one keyword to decide a bid is
                exactly the reader who must know these two are approximate. */}
            <p className="text-[11.5px] leading-relaxed text-ink-muted">
              Impression share is an impression-weighted average over the days Google reported one,
              so it can differ slightly from Google&apos;s own figure for the same range. Quality
              Score is the latest value in the window — it is a grade, and averaging grades is
              meaningless. Spend, clicks and conversions are exact.
            </p>
          </div>
        )}
      </DetailModal>
    </GoogleTabFrame>
  );
}
