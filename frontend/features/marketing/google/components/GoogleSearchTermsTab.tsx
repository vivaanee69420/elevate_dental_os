'use client';
// ============================================================================
// Google report — Search terms tab. What people ACTUALLY TYPED, as opposed to
// what we bid on.
//
// This is the one Google report that says where money is leaking, and it
// cannot be derived from anything else stored: a dental group paying for
// "dental nurse jobs", "dentist salary uk" or a competitor's name finds out
// here and nowhere else. Keywords tell you what you bid on; search terms tell
// you what you bought.
//
// TWO THINGS THIS TAB DOES DIFFERENTLY, both stated on screen rather than
// assumed:
//
//   1. A 30-DAY WINDOW, not the 92 every other deep grain keeps. Search terms
//      are (term x ad group x day) — an order of magnitude more rows than any
//      other grain — and the report is one you act on for RECENT traffic. The
//      window comes from the server (`windowDays`), never a literal here, so
//      the tab cannot claim a period the sync does not pull.
//
//   2. Rows carry the KEYWORD THAT CAUGHT THE TERM and Google's own
//      ADDED / EXCLUDED / NONE status. The keyword is the actionable half —
//      "this broad-match keyword is pulling in this rubbish" — and the status
//      is what stops a term already excluded being re-reported as actionable
//      every month.
// ============================================================================
import { useState } from 'react';
import { EmptyState } from '@/components/ui';
import { DeferUntilVisible } from '@/components/DeferUntilVisible';
import { DataGrid, type GridColumn } from '../../_shared/DataGrid';
import { SectionHead, FootNote } from '../../_shared/StatRail';
import { ShareBar, Chip, humanise } from '../../_shared/Bars';
import { money, money0, num, ctr, conversions as fmtConversions, DASH } from '../../_shared/format';
import { deliveryColumns } from './columns';
import { DetailModal, Facts } from '../../_shared/DetailModal';
import { GoogleTabFrame, ShowMore } from './GoogleTabFrame';
import { useGoogleSearchTerms } from '../hooks';
import type { GoogleSearchTermRow } from '../api';

// EXCLUDED is the only one of the three that is a judgement already made, and
// it is the one worth seeing at a glance: it means someone has dealt with this
// term, so it is not on the list of things to act on. ADDED and NONE are
// states, not verdicts, and stay neutral.
function termTone(status: string | null): 'neutral' | 'good' | 'muted' {
  if (!status) return 'muted';
  if (/EXCLUDED/i.test(status)) return 'muted';
  if (/ADDED/i.test(status)) return 'good';
  return 'neutral';
}

export function GoogleSearchTermsTab({ parentId }: { parentId: string | null }) {
  const {
    data, isLoading, isError, error, hasNextPage, fetchNextPage, isFetchingNextPage,
  } = useGoogleSearchTerms(parentId);

  const [selected, setSelected] = useState<GoogleSearchTermRow | null>(null);
  const first = data?.pages[0];
  const rows = data?.pages.flatMap((p) => p.rows) ?? [];
  const maxSpend = rows.reduce((m, r) => Math.max(m, r.spendPence), 0);

  const columns: GridColumn<GoogleSearchTermRow>[] = [
    {
      key: 'name', header: 'Search term', align: 'left', width: 'min-w-[280px]',
      sortBy: (r) => r.name ?? '',
      // In quotation marks because it is a QUOTE — somebody typed this. Every
      // other name column on this page is a label an advertiser chose; this
      // one is not, and reading it as one is how a term gets mistaken for a
      // keyword.
      render: (r) => <span className="text-ink">&ldquo;{r.name ?? r.id}&rdquo;</span>,
      sub: (r) => (
        <>
          <span className="flex items-center gap-2">
            {r.termStatus && <Chip tone={termTone(r.termStatus)}>{humanise(r.termStatus)}</Chip>}
            {/* The keyword that caught it — the link that makes a rubbish term
                actionable, because it names what to add a negative against. */}
            {r.keywordText
              ? (
                <span className="min-w-0 truncate">
                  matched {r.matchType ? `${humanise(r.matchType)?.toLowerCase()} ` : ''}
                  &ldquo;{r.keywordText}&rdquo;
                </span>
              )
              : <span className="text-ink-muted">no keyword (Performance Max)</span>}
          </span>
          <ShareBar value={r.spendPence} max={maxSpend} title={`${money(r.spendPence)} of ${money(maxSpend)}`} />
        </>
      ),
    },
    ...deliveryColumns<GoogleSearchTermRow>(),
    {
      key: 'adgroup', header: 'Ad group', align: 'right', width: 'w-[160px]',
      sortBy: (r) => r.parentName ?? 'zzz',
      render: (r) => <span className="text-ink-muted">{r.parentName ?? DASH}</span>,
      sub: (r) => r.campaignName ?? null,
    },
  ];

  return (
    <GoogleTabFrame
      state={first?.state}
      isLoading={isLoading}
      isError={isError}
      errorLabel={`Couldn't load search terms: ${(error as Error)?.message ?? 'unknown error'}`}
      windowClamped={first?.windowClamped}
      freshness={first?.freshness}
      effectiveSince={first?.effectiveSince}
      windowDays={first?.windowDays ?? 30}
      excludedAccounts={first?.excludedAccounts}
      footer={(
        <>
          <ShowMore
            hasNext={Boolean(hasNextPage)}
            isFetching={isFetchingNextPage}
            onClick={() => fetchNextPage()}
            label="Show more search terms"
          />
          <FootNote>
            Kept for {first?.windowDays ?? 30} days rather than the 92 the other tabs hold — a
            search term report is one you act on for recent traffic, and it carries an order of
            magnitude more rows than any other view. Performance Max campaigns contribute spend
            here but no matched keyword, which is Google&apos;s design rather than a gap.
          </FootNote>
        </>
      )}
    >
      <div className="flex flex-col gap-2">
        <SectionHead
          title="Search terms"
          note="Sorted by spend, so the terms costing the most sit at the top — which is the list you want when adding negative keywords."
          right={<span className="text-[12px] text-ink-muted">{num(rows.length)} shown</span>}
        />
        <DeferUntilVisible minHeight={360}>
          <DataGrid
            columns={columns}
            rows={rows}
            rowKey={(r) => `${r.id}-${r.parentId ?? ''}`}
            emptyState={<EmptyState message="No search terms recorded in this window." />}
            rowTone={(r) => (r.spendPence > 0 ? 'default' : 'muted')}
            onRowClick={setSelected}
          />
        </DeferUntilVisible>
      </div>

      <DetailModal
        open={selected !== null}
        title={selected ? `“${selected.name ?? selected.id}”` : ''}
        subtitle={selected && [selected.campaignName, selected.parentName].filter(Boolean).join(' · ')}
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
              { label: 'Matched keyword',
                value: selected.keywordText ? `“${selected.keywordText}”` : DASH,
                note: selected.matchType ? humanise(selected.matchType) ?? undefined : 'Performance Max — no keyword' },
              { label: 'Status', value: humanise(selected.termStatus) ?? DASH },
            ]}
            />
            {/* The action this report exists for, spelled out. A search term
                report is only worth reading if the reader knows what to DO
                with a bad row, and the answer is a negative keyword on the ad
                group named above — not on the term itself, which is not an
                object in the account and cannot be edited. */}
            <p className="text-[11.5px] leading-relaxed text-ink-muted">
              {selected.termStatus && /EXCLUDED/i.test(selected.termStatus)
                ? 'This term is already excluded — it is shown so its historic cost stays visible, not because it needs action.'
                : 'If this term is not worth paying for, add it as a negative keyword on the ad group above. A search term is not an object in the Google account, so it cannot be edited directly.'}
            </p>
          </div>
        )}
      </DetailModal>
    </GoogleTabFrame>
  );
}
