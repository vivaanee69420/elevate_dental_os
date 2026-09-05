'use client';
// ============================================================================
// Google report — Campaigns tab. ONE table per campaign, not two.
//
// This used to be two tables on one screen: a "By campaign" table above the
// tab strip (spend → leads → patients → collected) and this tab (impressions,
// conversions, impression share). The same six campaigns, listed twice, in two
// places, with no indication they were the same rows. That is duplication, not
// depth — and it is the first thing anyone noticed about the page.
//
// So they are merged. The ROW carries the money story, which is what the
// report is for: what a campaign cost and what it produced. Expanding a row
// reveals Google's OWN delivery figures beneath it — impressions, clicks,
// tracked conversions, conversion value, call-extension calls and impression
// share — which are a different measurement of the same campaign and belong
// underneath it rather than beside it.
//
// WHY GOOGLE'S CONVERSIONS ARE NOT A COLUMN. They count something different
// from the lead funnel: Google counts a tracked conversion action, we count a
// deduplicated human being who rang or filled in a form and then turned up at
// a practice. Putting the two side by side in adjacent columns invites reading
// one as a check on the other, and they will never agree. Nested, the
// relationship is obvious: this is what the money bought, and this is what
// Google thinks it bought.
//
// ROWS WITH £0 SPEND AND REAL LEADS ARE NOT A BUG. A campaign that stopped
// spending mid-period still produces calls from clicks it paid for earlier —
// CallRail stamps a call with the campaign from the visitor's session, which
// can predate the window. Those rows say so in words rather than leaving the
// reader to wonder why a campaign with no spend has patients.
// ============================================================================
import { useState } from 'react';
import { EmptyState } from '@/components/ui';
import { DeferUntilVisible } from '@/components/DeferUntilVisible';
import type { UseQueryResult } from '@tanstack/react-query';
import { DataGrid, type GridColumn } from '../../_shared/DataGrid';
import { SectionHead, FootNote } from '../../_shared/StatRail';
import { ShareBar, FunnelBar, ImpressionShareBar, Chip, humanise } from '../../_shared/Bars';
import {
  money, money0, num, ctr, multiple, conversions as fmtConversions, DASH,
} from '../../_shared/format';
import { DetailModal } from '../../_shared/DetailModal';
import { GoogleTabFrame } from './GoogleTabFrame';
import { CampaignHighlights } from './CampaignHighlights';
import { CampaignLeads } from './CampaignLeads';
import { useGoogleLeadPerformance } from '../hooks';
import type {
  GoogleCampaignsPayload, GoogleCampaignRow, GoogleCampaignPerformance, GoogleLeadRow,
} from '../api';

// The unattributed bucket's row key. It has a null campaignId by definition,
// and a Map/React key of `null` collapses every such row into one — which
// happens to be right here (there is only ever one) but is right by accident,
// so it is named instead.
const UNATTRIBUTED_KEY = '__unattributed__';

// One merged row: the lead/money figures, plus whatever Google reported for
// the same campaign. Built from the two payloads by campaign id.
type MergedRow = GoogleCampaignPerformance & { delivery: GoogleCampaignRow | null };

function mergeRows(
  performance: GoogleCampaignPerformance[],
  delivery: GoogleCampaignRow[],
): MergedRow[] {
  const byId = new Map(delivery.map((d) => [d.id, d]));
  // Driven by the PERFORMANCE side, not the delivery side. That side already
  // contains every campaign with spend (it is seeded from the same
  // ad_metrics rollup) AND every campaign that produced a lead without
  // spending in the window, plus the unattributed bucket. Driving from
  // delivery would silently drop all three.
  return performance.map((p) => ({
    ...p,
    delivery: p.campaignId ? (byId.get(p.campaignId) ?? null) : null,
  }));
}

// Google's own delivery for one campaign, shown under the row rather than
// beside it — see this file's header for why these are not columns.
function Delivery({ row }: { row: MergedRow }) {
  const d = row.delivery;
  if (!d) {
    return (
      <p className="text-[12px] text-ink-muted">
        {row.attributed
          ? 'Google reported no delivery for this campaign in the selected period — the leads below it came from clicks paid for earlier.'
          : 'These leads could not be tied to a campaign, so there is no Google delivery to show for them.'}
      </p>
    );
  }
  const items: { label: string; value: string; note?: string }[] = [
    { label: 'Impressions', value: num(d.impressions), note: `${num(d.clicks)} clicks · ${ctr(d.ctr)}` },
    { label: 'Cost per click', value: money(d.cpcPence) },
    {
      label: 'Google conversions',
      value: fmtConversions(d.conversions),
      note: d.costPerConversionPence === null ? undefined : `${money(d.costPerConversionPence)} each`,
    },
    {
      label: 'Conversion value',
      value: money0(d.conversionsValuePence),
      note: d.roas === null ? undefined : `${multiple(d.roas)} of spend`,
    },
    { label: 'Calls from ads', value: d.phoneCalls === null ? DASH : num(d.phoneCalls) },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-x-10 gap-y-3">
        {items.map((it) => (
          <div key={it.label}>
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-ink-muted">
              {it.label}
            </p>
            <p className="mt-0.5 tabular-nums text-[13px] text-ink">{it.value}</p>
            {it.note && <p className="text-[11px] text-ink-muted">{it.note}</p>}
          </div>
        ))}
        <div>
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-ink-muted">
            Impression share
          </p>
          <div className="mt-1">
            <ImpressionShareBar
              won={d.searchImpressionShare}
              lostToBudget={d.searchBudgetLostImpressionShare}
              lostToRank={d.searchRankLostImpressionShare}
            />
          </div>
        </div>
      </div>
      {/* Google counts a tracked conversion action; the row above counts a
          deduplicated person who rang or filled in a form and then turned up.
          Said plainly, because the two numbers will never agree and a reader
          comparing them without this will conclude one of them is broken. */}
      <p className="text-[11.5px] text-ink-muted">
        Google&apos;s own tracked conversions count conversion actions, not people — they will not
        match the leads and patients above, and are not meant to.
      </p>
    </div>
  );
}

export function GoogleCampaignsTab({
  query,
  includeExisting,
  onSelectCampaign,
}: {
  query: UseQueryResult<GoogleCampaignsPayload>;
  includeExisting: boolean;
  onSelectCampaign: (id: string) => void;
}) {
  const { data, isLoading, isError, error } = query;
  // The SAME query the summary rail above reads — React Query dedupes on the
  // key, so this costs no request. Reading it here rather than threading the
  // rows down as props keeps the tab able to render on its own.
  const perf = useGoogleLeadPerformance();
  // The row whose detail dialog is open. Held as the ROW, not an id, so a
  // highlight card and a table click open exactly the same dialog with exactly
  // the same data instead of two paths that can drift.
  const [selected, setSelected] = useState<MergedRow | null>(null);

  const allLeads: GoogleLeadRow[] = perf.data?.state === 'ok' ? perf.data.leads : [];

  const performance = perf.data?.state === 'ok'
    ? (includeExisting ? perf.data.campaignsAll : perf.data.campaigns)
    : [];
  const rows = mergeRows(performance, data?.rows ?? []);
  const maxSpend = rows.reduce((m, r) => Math.max(m, r.spendPence), 0);

  const columns: GridColumn<MergedRow>[] = [
    {
      key: 'name', header: 'Campaign', align: 'left', width: 'min-w-[240px]',
      sortBy: (r) => r.campaignName ?? 'zzzz',
      render: (r) => (
        <span className={r.attributed ? 'font-medium text-ink' : 'italic'}>
          {r.campaignName ?? (r.attributed ? r.campaignId : 'Not attributed')}
        </span>
      ),
      sub: (r) => {
        if (!r.attributed) return 'Leads with no resolvable campaign';
        return (
          <>
            <span className="flex items-center gap-2">
              {r.channelType && <Chip>{humanise(r.channelType)}</Chip>}
              {/* A campaign with leads but no spend this period is real, not a
                  fault: CallRail stamps a call with the visitor's session
                  campaign, which can predate the window. */}
              {r.spendPence === 0 && r.leads > 0 && (
                <Chip tone="muted">no spend this period</Chip>
              )}
            </span>
            <ShareBar value={r.spendPence} max={maxSpend} />
          </>
        );
      },
    },
    {
      key: 'spend', header: 'Spend', align: 'right', sortBy: (r) => r.spendPence,
      render: (r) => (r.attributed ? money0(r.spendPence) : DASH),
      sub: (r) => (r.delivery?.cpcPence == null ? null : `${money(r.delivery.cpcPence)} / click`),
    },
    {
      key: 'funnel', header: 'Leads → patients', align: 'left', width: 'w-[132px]',
      sortBy: (r) => r.leads,
      render: (r) => (
        <span className="flex items-baseline gap-1.5 tabular-nums">
          <span className="font-medium">{num(r.leads)}</span>
          <span className="text-ink-muted">→</span>
          <span>{num(r.booked)}</span>
          <span className="text-ink-muted">→</span>
          <span className="font-medium">{num(r.accepted)}</span>
        </span>
      ),
      sub: (r) => <FunnelBar leads={r.leads} booked={r.booked} accepted={r.accepted} />,
    },
    {
      key: 'cpl', header: 'Cost / lead', align: 'right', sortBy: (r) => r.cplPence,
      render: (r) => money(r.cplPence),
    },
    {
      key: 'cpa', header: 'Cost / patient', align: 'right', sortBy: (r) => r.cpaPence,
      render: (r) => money(r.cpaPence),
      sub: (r) => (r.cpbPence === null ? null : `${money(r.cpbPence)} / booking`),
    },
    {
      key: 'collected', header: 'Collected', align: 'right', sortBy: (r) => r.paidPence,
      // The one outcome column on the page, so the only one that carries the
      // brand colour. A page where several things are coloured is a page where
      // none of them mean anything.
      render: (r) => (
        <span className={r.paidPence > 0 ? 'font-medium text-brand-700' : ''}>
          {money0(r.paidPence)}
        </span>
      ),
      sub: (r) => (r.returnOnSpend === null ? null : `${multiple(r.returnOnSpend)} of spend`),
    },
  ];

  const coverage = perf.data?.state === 'ok' ? perf.data.attribution : null;
  const coveragePct = coverage && coverage.total > 0
    ? Math.round((coverage.attributed / coverage.total) * 100) : null;

  const ROUTE_LABEL: Record<string, string> = {
    callrail_keyword: 'Keyword (call)',
    callrail_campaign: 'Campaign (call)',
    ghl_campaign: 'Campaign (form)',
  };

  return (
    <GoogleTabFrame
      state={data?.state}
      isLoading={isLoading}
      isError={isError}
      errorLabel={`Couldn't load campaigns: ${(error as Error)?.message ?? 'unknown error'}`}
      excludedAccounts={data?.excludedAccounts}
      footer={coverage && (
        <FootNote>
          {coveragePct === null
            ? 'No leads in this period, so there is nothing to attribute.'
            : (
              <>
                {num(coverage.attributed)} of {num(coverage.total)} leads ({coveragePct}%) could be
                tied to a campaign
                {Object.keys(coverage.byRoute).length > 0 && (
                  <>
                    {' '}—{' '}
                    {Object.entries(coverage.byRoute)
                      .map(([route, n]) => `${num(n)} by ${ROUTE_LABEL[route] ?? route}`)
                      .join(', ')}
                  </>
                )}
                . The rest are listed as <span className="italic">Not attributed</span> so the rows
                still add up to the totals above: a call with no campaign recorded, or a web form
                whose landing page carried no Google campaign id.
              </>
            )}
        </FootNote>
      )}
    >
      <div className="flex flex-col gap-4">
        {/* The winners sit WITH the table they summarise, not above the tab
            strip. A card naming a campaign in one place and a table listing it
            in another is how this page ended up showing the same six campaigns
            twice; keeping them together is the rule now, at every tier. */}
        <CampaignHighlights
          campaigns={performance}
          onOpenCampaign={(id) => setSelected(rows.find((r) => r.campaignId === id) ?? null)}
        />
        <SectionHead
          title="Campaigns"
          note="What each campaign cost and what it produced. Open a row for Google's own delivery and the people it brought in."
          right={<span className="text-[12px] text-ink-muted">{num(rows.length)} rows</span>}
        />
        <DeferUntilVisible minHeight={360}>
          <DataGrid
            columns={columns}
            rows={rows}
            rowKey={(r) => r.campaignId ?? UNATTRIBUTED_KEY}
            rowTone={(r) => (r.attributed ? 'default' : 'muted')}
            emptyState={<EmptyState message="No Google campaign activity in this window." />}
            // EXPAND, not navigate. A campaign row now has two useful
            // destinations — Google's delivery detail and its ad groups — and
            // a click that silently picked one is exactly the behaviour that
            // made the old ad-group row feel arbitrary. The panel shows the
            // first and offers the second as an explicit link.
            onRowClick={setSelected}
          />
        </DeferUntilVisible>
      </div>

      <DetailModal
        open={selected !== null}
        title={selected?.campaignName ?? (selected?.attributed ? (selected?.campaignId ?? '') : 'Not attributed')}
        subtitle={selected && (selected.attributed
          ? `${money0(selected.spendPence)} spent · ${num(selected.leads)} leads · ${num(selected.accepted)} patients · ${money0(selected.paidPence)} collected`
          : 'Leads that could not be tied to a campaign')}
        onClose={() => setSelected(null)}
      >
        {selected && (
          <div className="flex flex-col gap-5">
            <Delivery row={selected} />
            {/* THE PEOPLE BEHIND THE NUMBER. The row says a campaign produced
                5 patients; this says who they were, what they came for and
                what they have paid. Already fetched — every lead carries its
                own campaignId (migration 000165) — so this costs no request. */}
            <CampaignLeads
              leads={allLeads}
              campaignId={selected.campaignId}
              attributed={selected.attributed}
            />
            {selected.attributed && selected.campaignId && (
              <button
                type="button"
                onClick={() => { const id = selected.campaignId!; setSelected(null); onSelectCampaign(id); }}
                className="w-fit text-[12.5px] font-medium text-brand hover:underline"
              >
                View this campaign&apos;s ad groups →
              </button>
            )}
          </div>
        )}
      </DetailModal>
    </GoogleTabFrame>
  );
}
