'use client';
// Facebook report — Ad sets tab. Ported from the old FacebookAdSetsScreen
// (deleted, Task 3), with two changes: `campaignId` is now an OPTIONAL
// filter threaded down from the URL rather than a route param the screen
// could not function without (Task 2 moved it off the path), and clicking a
// row calls `onSelectAdSet` — a tab switch, not a route navigation — instead
// of expanding ads inline beneath it (the old FacebookAdRows expand-in-place
// idiom is retired; ads now live on their own tab, filtered the same way).
//
// Everything else survives: the state notice (now correctly scoped to
// 'campaign' only when a campaign filter is actually active, 'organisation'/
// 'selection' otherwise — the old screen hardcoded 'campaign' because the
// nested route always had one), the clamped-window note, and BOTH bucket
// rows (notIdentified / unmatchedLeads) — two distinct reasons a lead can
// fail to land in a row above, so collapsing them would lose leads outright.
import { useMemo } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { EmptyState, SkeletonTable } from '@/components/ui';
import { DeferUntilVisible } from '@/components/DeferUntilVisible';
import { formatDate } from '@/lib/format';
import { useScopePeriod } from '@/features/_shared/scope-context';
import { AdMetricTable, type Column } from '../../_shared/AdMetricTable';
import { money, ctr, num, DASH } from '../../_shared/format';
import { FacebookStateNotice } from './FacebookStateNotice';
import type {
  FacebookAdSetsPayload, FacebookRow, FacebookFunnelTotals, FacebookNoticeScope,
} from '../api';
import SpendFreshnessNote from '@/features/marketing/_shared/SpendFreshnessNote';

type DisplayRow =
  | { kind: 'data'; row: FacebookRow }
  | { kind: 'bucket'; label: string; title: string; funnel: FacebookFunnelTotals };

// Calm, factual prose — never an error/warning colour. These are facts about
// the data, not problems with it.
function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-panel border border-border bg-bg px-3 py-2 text-[12.5px] leading-relaxed text-ink-muted">
      {children}
    </p>
  );
}

const COLUMNS: Column<DisplayRow>[] = [
  {
    key: 'name',
    header: 'Ad set',
    align: 'left',
    render: (r) => (r.kind === 'bucket' ? (
      <span className="italic text-ink-muted" title={r.title}>{r.label}</span>
    ) : (
      <span className="font-medium text-brand">{r.row.name ?? r.row.id ?? 'Unnamed ad set'}</span>
    )),
  },
  { key: 'spend', header: 'Spend', align: 'right', render: (r) => (r.kind === 'bucket' ? DASH : money(r.row.spendPence)) },
  { key: 'impressions', header: 'Impressions', align: 'right', render: (r) => (r.kind === 'bucket' ? DASH : num(r.row.impressions)) },
  { key: 'clicks', header: 'Clicks', align: 'right', render: (r) => (r.kind === 'bucket' ? DASH : num(r.row.clicks)) },
  { key: 'ctr', header: 'CTR', align: 'right', render: (r) => (r.kind === 'bucket' ? DASH : ctr(r.row.ctr)) },
  { key: 'cpc', header: 'CPC', align: 'right', render: (r) => (r.kind === 'bucket' ? DASH : money(r.row.cpcPence)) },
  { key: 'leads', header: 'Leads', align: 'right', render: (r) => num(r.kind === 'bucket' ? r.funnel.leads : r.row.leads) },
  { key: 'booked', header: 'Booked', align: 'right', render: (r) => num(r.kind === 'bucket' ? r.funnel.booked : r.row.booked) },
  { key: 'attended', header: 'Attended*', align: 'right', render: (r) => num(r.kind === 'bucket' ? r.funnel.attended : r.row.attended) },
  { key: 'patients', header: 'Patients', align: 'right', render: (r) => num(r.kind === 'bucket' ? r.funnel.patients : r.row.patients) },
  { key: 'cpl', header: 'CPL', align: 'right', render: (r) => (r.kind === 'bucket' ? DASH : money(r.row.cplPence)) },
  { key: 'cpb', header: 'CPB', align: 'right', render: (r) => (r.kind === 'bucket' ? DASH : money(r.row.cpbPence)) },
  { key: 'cpa', header: 'CPA', align: 'right', render: (r) => (r.kind === 'bucket' ? DASH : money(r.row.cpaPence)) },
];

export function FacebookAdSetsTab({
  query,
  campaignId,
  onSelectAdSet,
}: {
  query: UseQueryResult<FacebookAdSetsPayload>;
  /** The active campaign filter, or null when this tab is listing every ad
   *  set in the window unfiltered. */
  campaignId: string | null;
  onSelectAdSet: (id: string) => void;
}) {
  const { data, isLoading, isError, error } = query;

  // What this payload's state/coverage was actually measured over: ONE
  // campaign when a filter is active (the old screen's only mode, since the
  // nested route always carried a campaignId), otherwise the same
  // organisation/selection distinction the Campaigns tab makes.
  const { scope } = useScopePeriod();
  const noticeScope: FacebookNoticeScope = campaignId
    ? 'campaign'
    : (scope && scope !== 'all' ? 'selection' : 'organisation');

  // Platform metrics stand on their own even without ad-id coverage; only
  // 'not_connected'/'never_synced' have literally nothing to show. An empty
  // window ('no_spend_in_window') still shows the table when there are
  // unplaceable leads to account for — that is exactly the case where the
  // campaign tier reports leads and this tier must not silently show none.
  const showTable = data && (
    data.state === 'ok'
    || data.state === 'no_ad_id_coverage'
    || (data.state === 'no_spend_in_window' && Boolean(data.notIdentified || data.unmatchedLeads))
  );

  // TWO bucket rows, not one, because there are two distinct ways a lead can
  // fail to sit in a data row above — and folding them together, or omitting
  // either, loses leads outright: the campaign tier would say 100 while this
  // table summed to 80.
  const rows: DisplayRow[] = useMemo(() => {
    if (!data) return [];
    const out: DisplayRow[] = data.rows.map((row) => ({ kind: 'data' as const, row }));
    if (data.notIdentified) {
      out.push({
        kind: 'bucket',
        label: 'Ad set not identified',
        title: 'Leads attributed to this campaign whose ad set Meta did not report. Their spend cannot be split back out from the real ad sets above, so no cost is shown for them.',
        funnel: data.notIdentified,
      });
    }
    if (data.unmatchedLeads) {
      out.push({
        kind: 'bucket',
        label: 'Ad set not shown here',
        title: 'Leads whose ad set is known but has no spend in this period — either it was not delivering, or its spend belongs to a practice outside the current filter. Counted here so this table still adds up to the campaign total.',
        funnel: data.unmatchedLeads,
      });
    }
    return out;
  }, [data]);

  if (isError) {
    return <EmptyState message={`Couldn't load ad sets: ${(error as Error)?.message ?? 'unknown error'}`} />;
  }
  if (isLoading && !data) return <SkeletonTable rows={8} cols={13} />;
  if (!data) return null;

  return (
    <div className="flex flex-col gap-4">
      <FacebookStateNotice state={data.state} coverage={data.coverage} scope={noticeScope} />

      <SpendFreshnessNote freshness={data.freshness} />

      {data.windowClamped && (
        <Note>
          Ad set and ad detail is kept for 92 days. This period reaches further back
          than that, so figures below are shown from {formatDate(data.effectiveSince)}
          {' '}onward rather than the whole period.
        </Note>
      )}

      {showTable && (
        <DeferUntilVisible minHeight={360}>
          <AdMetricTable
            columns={COLUMNS}
            rows={rows}
            onRowClick={(r) => { if (r.kind === 'data' && r.row.id) onSelectAdSet(r.row.id); }}
            emptyState={<EmptyState message="No Facebook ad set spend in this window." />}
          />
          <p className="mt-2 text-[12px] text-ink-muted">
            * Attended is Dentally-only — a GoHighLevel booking alone cannot say whether
            someone turned up.
          </p>
        </DeferUntilVisible>
      )}
    </div>
  );
}
