'use client';
// ============================================================================
// Google report — Ad groups tab.
//
// THE ROW CLICK NO LONGER TELEPORTS, AND THAT IS THE POINT OF THIS FILE.
//
// It used to set `?tab=ads&parentId=…` — you clicked an ad group and landed on
// a different tab. Two things were wrong with that, and they compound:
//
//   1. Google's hierarchy FORKS here. An ad group has ads AND keywords under
//      it, as siblings; neither contains the other. Navigating to one of them
//      is choosing for the reader, and there is no basis for the choice —
//      keywords are at least as likely to be what they wanted.
//
//   2. What you landed on was unreadable. ad_group_ad.ad.name is an optional
//      internal label almost nobody sets: 0 of 186 ads in this org had one, so
//      the destination was a list of 12-digit numbers. (Fixed separately — ads
//      now fall back to their first headline — but the jump was wrong even
//      once the destination made sense.)
//
// So the row EXPANDS IN PLACE and shows both children side by side, with the
// reader still where they were. The Ads and Keywords tabs remain, unfiltered
// and independent, for anyone who wants to work through one of them across
// every ad group at once.
//
// The child queries live in a component that only mounts when a row opens, so
// a closed table issues no requests for children at all.
// ============================================================================
import { useState } from 'react';
import { EmptyState } from '@/components/ui';
import { DeferUntilVisible } from '@/components/DeferUntilVisible';
import type { UseQueryResult } from '@tanstack/react-query';
import { DataGrid, type GridColumn } from '../../_shared/DataGrid';
import { SectionHead } from '../../_shared/StatRail';
import { Chip, humanise } from '../../_shared/Bars';
import { money0, num, DASH } from '../../_shared/format';
import { nameColumn, deliveryColumns, impressionShareColumn } from './columns';
import { BestPerformer, bestByCostPerConversion, unrankedNote } from '../../_shared/BestPerformer';
import { DetailModal } from '../../_shared/DetailModal';
import { GoogleTabFrame } from './GoogleTabFrame';
import { useGoogleAds, useGoogleKeywords } from '../hooks';
import type { GoogleAdGroupsPayload, GoogleAdGroupRow } from '../api';

// A compact list, not a nested DataGrid. An expansion panel containing a
// second full table — its own sticky header, its own sort controls, its own
// horizontal scroll — would be a table inside a table row, which is exactly
// the boxes-inside-boxes problem this redesign is undoing. Five lines of
// "name … spend" is what the reader needs at this depth; the dedicated tab is
// one click away for anything more.
function MiniList({
  title, empty, loading, items, more,
}: {
  title: string;
  empty: string;
  loading: boolean;
  items: { key: string; label: string; note?: string | null; right: string }[];
  more: number;
}) {
  return (
    <div className="min-w-0 flex-1">
      <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-ink-muted">
        {title}
      </p>
      {loading && <p className="text-[12px] text-ink-muted">Loading…</p>}
      {!loading && items.length === 0 && <p className="text-[12px] text-ink-muted">{empty}</p>}
      <ul className="flex flex-col gap-1">
        {items.map((it) => (
          <li key={it.key} className="flex items-baseline justify-between gap-3 text-[12.5px]">
            <span className="min-w-0 truncate text-ink">
              {it.label}
              {it.note && <span className="ml-1.5 text-[11px] text-ink-muted">{it.note}</span>}
            </span>
            <span className="shrink-0 tabular-nums text-ink-muted">{it.right}</span>
          </li>
        ))}
      </ul>
      {/* Said out loud rather than silently truncated. A list that stops
          without saying so is the same class of lie as a truncated total. */}
      {more > 0 && (
        <p className="mt-1 text-[11px] text-ink-muted">
          + {num(more)} more — see the {title.split(' ')[0].toLowerCase()} tab
        </p>
      )}
    </div>
  );
}

// Both children of one ad group, fetched only once its row is open.
//
// TOP FIVE BY SPEND EACH, not everything. The panel answers "what is inside
// this ad group and where is its money going", which five rows answer and
// forty rows bury.
function AdGroupChildren({ adGroupId }: { adGroupId: string }) {
  const ads = useGoogleAds(adGroupId);
  const keywords = useGoogleKeywords(adGroupId);

  // The service already returns each tier sorted by spend descending, so the
  // first five of the first page ARE the top five — no re-sort needed, and
  // re-sorting a partial page would produce a "top five" of whatever happened
  // to be fetched.
  const adRows = ads.data?.pages.flatMap((p) => p.rows) ?? [];
  const kwRows = keywords.data?.pages.flatMap((p) => p.rows) ?? [];
  const LIMIT = 5;

  return (
    <div className="flex flex-col gap-5 sm:flex-row sm:gap-10">
      <MiniList
        title={`Ads${adRows.length ? ` (${num(adRows.length)})` : ''}`}
        empty="No ads with delivery here."
        loading={ads.isLoading}
        more={Math.max(0, adRows.length - LIMIT)}
        items={adRows.slice(0, LIMIT).map((r) => ({
          key: r.id ?? '',
          // The ad's first headline, which is what a person calls an ad — see
          // this file's header for why the id alone was useless.
          label: r.name ?? r.id ?? 'Unnamed ad',
          note: r.adStrength ? humanise(r.adStrength) : null,
          right: money0(r.spendPence),
        }))}
      />
      <MiniList
        title={`Keywords${kwRows.length ? ` (${num(kwRows.length)})` : ''}`}
        // Not a failure. Performance Max campaigns have no keywords at all,
        // and saying so is the difference between the reader trusting the
        // blank and reporting it as a bug.
        empty="No keywords — Performance Max campaigns have none by design."
        loading={keywords.isLoading}
        more={Math.max(0, kwRows.length - LIMIT)}
        items={kwRows.slice(0, LIMIT).map((r) => ({
          key: `${r.id}-${r.parentId ?? ''}`,
          label: r.name ?? r.id ?? '',
          note: r.matchType ? humanise(r.matchType) : null,
          right: money0(r.spendPence),
        }))}
      />
    </div>
  );
}

export function GoogleAdGroupsTab({
  query,
}: {
  query: UseQueryResult<GoogleAdGroupsPayload>;
}) {
  const { data, isLoading, isError, error } = query;
  const [selected, setSelected] = useState<GoogleAdGroupRow | null>(null);
  const rows = data?.rows ?? [];
  const maxSpend = rows.reduce((m, r) => Math.max(m, r.spendPence), 0);

  const columns: GridColumn<GoogleAdGroupRow>[] = [
    nameColumn<GoogleAdGroupRow>('Ad group', maxSpend, 'Unnamed ad group'),
    ...deliveryColumns<GoogleAdGroupRow>(),
    {
      key: 'status', header: 'Status', align: 'right', width: 'w-[100px]',
      sortBy: (r) => r.status ?? 'zzz',
      render: (r) => (r.status
        ? <Chip tone={/PAUSED|REMOVED/i.test(r.status) ? 'muted' : 'neutral'}>{humanise(r.status)}</Chip>
        : DASH),
    },
    impressionShareColumn<GoogleAdGroupRow>(),
  ];

  return (
    <GoogleTabFrame
      state={data?.state}
      isLoading={isLoading}
      isError={isError}
      errorLabel={`Couldn't load ad groups: ${(error as Error)?.message ?? 'unknown error'}`}
      windowClamped={data?.windowClamped}
      freshness={data?.freshness}
      effectiveSince={data?.effectiveSince}
      excludedAccounts={data?.excludedAccounts}
    >
      <div className="flex flex-col gap-4">
        {/* Ranked on Google's own conversions, not patients — only 52 of 262
            leads in a live month resolve to an ad group, which is enough to
            SHOW on a row and nowhere near enough to rank on. The card says so
            on its face. */}
        <BestPerformer
          onOpen={() => {
            const best = bestByCostPerConversion(rows.map((r) => ({
              id: r.id, name: r.name, spendPence: r.spendPence,
              conversions: r.conversions, costPerConversionPence: r.costPerConversionPence,
            })));
            setSelected(rows.find((r) => r.id === best?.id) ?? null);
          }}
          label="Best ad group"
          row={bestByCostPerConversion(rows.map((r) => ({
            id: r.id, name: r.name,
            spendPence: r.spendPence, conversions: r.conversions,
            costPerConversionPence: r.costPerConversionPence,
          })))}
          fallbackName="Unnamed ad group"
          note={unrankedNote(rows.map((r) => ({
            id: r.id, name: r.name, spendPence: r.spendPence,
            conversions: r.conversions, costPerConversionPence: r.costPerConversionPence,
          })))}
        />
        <SectionHead
          title="Ad groups"
          note="Open a row to see the ads and the keywords inside it — they sit side by side under an ad group, so neither is hidden behind the other."
          right={<span className="text-[12px] text-ink-muted">{num(rows.length)} ad groups</span>}
        />
        <DeferUntilVisible minHeight={360}>
          <DataGrid
            columns={columns}
            rows={rows}
            rowKey={(r) => `${r.id}-${r.parentId ?? ''}`}
            emptyState={<EmptyState message="No Google ad group spend in this window." />}
            rowTone={(r) => (r.spendPence > 0 ? 'default' : 'muted')}
            onRowClick={setSelected}
          />
        </DeferUntilVisible>
      </div>

      {/* Both children of the ad group, side by side — the fork in Google's
          hierarchy that made a navigating row click arbitrary in the first
          place. Mounted only while the dialog is open, so a closed table
          issues no requests for children at all. */}
      <DetailModal
        open={selected !== null}
        title={selected?.name ?? selected?.id ?? 'Ad group'}
        subtitle={selected && [selected.campaignName, `${money0(selected.spendPence)} spent`]
          .filter(Boolean).join(' · ')}
        onClose={() => setSelected(null)}
      >
        {selected?.id && <AdGroupChildren adGroupId={selected.id} />}
      </DetailModal>
    </GoogleTabFrame>
  );
}
