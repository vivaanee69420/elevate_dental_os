'use client';
// ============================================================================
// The metric columns shared by the Google grain tabs.
//
// Five tabs render essentially the same eight numbers with a different first
// column and a different set of extras. Before this they each declared their
// own copy, which is five places for the em-dash contract to be forgotten and
// five places for "CTR" to end up meaning a fraction on one tab and a
// percentage on another.
//
// Delivery is a FUNCTION returning the array, not a shared constant, because
// the share-of-spend bar needs the table's own maximum — a value that only
// exists once the rows are known.
// ============================================================================
import type { GridColumn } from '../../_shared/DataGrid';
import { ShareBar, ImpressionShareBar, Chip, humanise } from '../../_shared/Bars';
import { money, money0, ctr, num, conversions as fmtConversions, multiple, DASH } from '../../_shared/format';
import type { GoogleRow, GoogleExtras } from '../api';

type Row = GoogleRow & Partial<GoogleExtras>;

/**
 * Name plus its lineage, with a share-of-spend bar underneath.
 *
 * The lineage line is not decoration. ad_google_rollup groups by (entity_id,
 * parent_id) and Google reuses a keyword's criterion id — and an ad's id —
 * across ad groups, so an unfiltered listing can legitimately show the SAME
 * id, with the same name, twice under the same campaign with different
 * numbers. The ad group is the only thing that tells those two rows apart.
 */
export function nameColumn<R extends Row>(
  header: string,
  maxSpend: number,
  fallback: string,
): GridColumn<R> {
  return {
    key: 'name',
    header,
    align: 'left',
    width: 'min-w-[240px]',
    sortBy: (r) => r.name ?? r.id ?? '',
    render: (r) => <span className="font-medium text-ink">{r.name ?? r.id ?? fallback}</span>,
    sub: (r) => (
      <>
        {(r.campaignName || r.parentName) && (
          <span className="block truncate">
            {[r.campaignName, r.parentName].filter(Boolean).join(' · ')}
          </span>
        )}
        <ShareBar value={r.spendPence} max={maxSpend} title={`${money(r.spendPence)} of ${money(maxSpend)}`} />
      </>
    ),
  };
}

/**
 * The eight delivery/cost numbers, in the order a reader consumes them:
 * what it cost, how often it showed, how often it was clicked, and what
 * Google says came of it.
 *
 * Impressions and clicks share a column — impressions as the figure and
 * clicks with CTR beneath — because they are one fact ("how much traffic")
 * and splitting them across two columns pushes the money off the screen.
 */
export function deliveryColumns<R extends Row>(): GridColumn<R>[] {
  return [
    {
      key: 'spend', header: 'Spend', align: 'right', sortBy: (r) => r.spendPence,
      render: (r) => money0(r.spendPence),
      sub: (r) => (r.cpcPence === null ? null : `${money(r.cpcPence)} / click`),
    },
    {
      key: 'traffic', header: 'Impressions', align: 'right', sortBy: (r) => r.impressions,
      render: (r) => num(r.impressions),
      sub: (r) => `${num(r.clicks)} clicks · ${ctr(r.ctr)}`,
    },
    {
      key: 'conversions', header: 'Conversions', align: 'right', sortBy: (r) => r.conversions,
      // Google's OWN tracked conversions, never the CRM funnel — the two
      // count different things and the page must not blur them. Fractional,
      // because Google reports modelled conversions as decimals.
      render: (r) => fmtConversions(r.conversions),
      sub: (r) => (r.costPerConversionPence === null ? null : `${money(r.costPerConversionPence)} each`),
    },
    {
      key: 'value', header: 'Conv. value', align: 'right',
      sortBy: (r) => r.conversionsValuePence ?? null,
      // Value, not just count. A campaign producing ten £40 enquiries and one
      // producing ten £4,000 implant consultations are identical in the
      // conversions column and nothing alike here.
      render: (r) => money0(r.conversionsValuePence ?? null),
      sub: (r) => (r.roas === null || r.roas === undefined ? null : `${multiple(r.roas)} of spend`),
    },
  ];
}

/**
 * Impression share, as one bar rather than five numeric columns.
 *
 * Google publishes the share you won and the two reasons you lost the rest —
 * budget and rank. As numbers those are ratios of a quantity (eligible
 * auctions) that appears nowhere on the page, and the reader must hold three
 * of them at once to draw a conclusion. As a bar the conclusion is the
 * picture: a long red segment says raise the budget, a long amber one says
 * raise the bid or fix the ad.
 */
export function impressionShareColumn<R extends Row>(): GridColumn<R> {
  return {
    key: 'is', header: 'Impr. share', align: 'right', width: 'w-[130px]',
    sortBy: (r) => r.searchImpressionShare ?? null,
    render: (r) => (
      <ImpressionShareBar
        won={r.searchImpressionShare ?? null}
        lostToBudget={r.searchBudgetLostImpressionShare ?? null}
        lostToRank={r.searchRankLostImpressionShare ?? null}
      />
    ),
  };
}

/** Status as a chip rather than a shouted enum. */
export function statusColumn<R extends Row>(): GridColumn<R> {
  return {
    key: 'status', header: 'Status', align: 'left', width: 'w-[110px]',
    sortBy: (r) => r.status ?? 'zzz',
    render: (r) => (r.status
      ? <Chip tone={/PAUSED|REMOVED|DISABLED/i.test(r.status) ? 'muted' : 'neutral'}>{humanise(r.status)}</Chip>
      : DASH),
  };
}
