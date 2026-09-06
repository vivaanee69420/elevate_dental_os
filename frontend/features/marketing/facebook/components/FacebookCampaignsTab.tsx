'use client';
// Facebook report — Campaigns tab. Ported from the old FacebookCampaignsScreen
// (deleted, Task 3) with one behavioural change: the campaign name is no
// longer a Link to a child route — clicking anywhere on the row calls
// `onSelectCampaign`, which the parent FacebookReportScreen turns into a
// `?tab=adsets&campaignId=…` filter switch. Everything else this screen said
// is preserved verbatim: the state notice, the clamped-window note, the
// unmatched-leads note, the excluded-currency note, and the em-dash cost
// formatting (now via the shared `_shared/format.ts` rather than a local
// copy — see that file's header for why a local copy is the wrong instinct).
import { useMemo } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { EmptyState, SkeletonTable } from '@/components/ui';
import { DeferUntilVisible } from '@/components/DeferUntilVisible';
import { formatDate } from '@/lib/format';
import { useScopePeriod } from '@/features/_shared/scope-context';
import { AdMetricTable, type Column } from '../../_shared/AdMetricTable';
import { money, ctr, num } from '../../_shared/format';
import { FacebookStateNotice } from './FacebookStateNotice';
import type {
  FacebookCampaignsPayload, FacebookRow, FacebookFunnelTotals, FacebookNoticeScope,
} from '../api';
import SpendFreshnessNote from '@/features/marketing/_shared/SpendFreshnessNote';

type DisplayRow = { kind: 'data'; row: FacebookRow } | { kind: 'totals'; row: FacebookRow };

// Meta's own campaign status, as the sync stamped it on the latest day in the
// window — ACTIVE, PAUSED, ARCHIVED, DELETED and so on. Only the not-running
// ones are worth a chip: labelling every live campaign "Active" is noise, but
// a campaign whose spend stopped because it was paused explains a falling row
// that otherwise looks like a performance problem. Title-cased for a British
// UI rather than shouted back in Meta's enum casing, and rendered verbatim for
// anything unrecognised so a new Meta status is never silently swallowed.
function StatusChip({ status }: { status: string | null }) {
  if (!status || status.toUpperCase() === 'ACTIVE') return null;
  const label = status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
  return (
    <span
      className="ml-2 rounded-full border border-border bg-bg px-2 py-0.5 align-middle text-[11px] font-normal text-ink-muted"
      title="Campaign status reported by Meta on the most recent day in this period."
    >
      {label}
    </span>
  );
}

// Calm, factual prose — never an error/warning colour. These are facts about
// the data, not problems with it.
function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-panel border border-border bg-bg px-3 py-2 text-[12.5px] leading-relaxed text-ink-muted">
      {children}
    </p>
  );
}

function unmatchedLeadsNote(funnel: FacebookFunnelTotals) {
  const noun = funnel.leads === 1 ? 'lead belongs' : 'leads belong';
  const pronoun = funnel.leads === 1 ? 'it is' : 'they are';
  return (
    <Note>
      {num(funnel.leads)} more Meta {noun} to a campaign with no spend recorded in this
      window, so {pronoun} not included in the table above.
    </Note>
  );
}

const COLUMNS: Column<DisplayRow>[] = [
  {
    key: 'name',
    header: 'Campaign',
    align: 'left',
    render: (r) => (r.kind === 'totals' ? (
      <span className="text-ink">Total</span>
    ) : (
      <span className="font-medium text-brand">
        {r.row.name ?? r.row.id}
        <StatusChip status={r.row.status} />
      </span>
    )),
  },
  { key: 'spend', header: 'Spend', align: 'right', render: (r) => money(r.row.spendPence) },
  { key: 'impressions', header: 'Impressions', align: 'right', render: (r) => num(r.row.impressions) },
  { key: 'clicks', header: 'Clicks', align: 'right', render: (r) => num(r.row.clicks) },
  { key: 'ctr', header: 'CTR', align: 'right', render: (r) => ctr(r.row.ctr) },
  { key: 'cpc', header: 'CPC', align: 'right', render: (r) => money(r.row.cpcPence) },
  { key: 'leads', header: 'Leads', align: 'right', render: (r) => num(r.row.leads) },
  { key: 'booked', header: 'Booked', align: 'right', render: (r) => num(r.row.booked) },
  { key: 'attended', header: 'Attended*', align: 'right', render: (r) => num(r.row.attended) },
  { key: 'patients', header: 'Patients', align: 'right', render: (r) => num(r.row.patients) },
  { key: 'cpl', header: 'CPL', align: 'right', render: (r) => money(r.row.cplPence) },
  { key: 'cpb', header: 'CPB', align: 'right', render: (r) => money(r.row.cpbPence) },
  { key: 'cpa', header: 'CPA', align: 'right', render: (r) => money(r.row.cpaPence) },
];

export function FacebookCampaignsTab({
  query,
  onSelectCampaign,
}: {
  query: UseQueryResult<FacebookCampaignsPayload>;
  onSelectCampaign: (id: string) => void;
}) {
  const { data, isLoading, isError, error } = query;
  // What this payload's coverage was actually measured over. Org-wide by
  // default, but the scope bar can narrow it to one practice — and a notice
  // that says "this organisation" over a one-practice measurement is a claim
  // the data does not support.
  const { scope } = useScopePeriod();
  const noticeScope: FacebookNoticeScope = scope && scope !== 'all' ? 'selection' : 'organisation';

  // Platform metrics stand on their own even without ad-id coverage. The
  // three remaining states all return zero rows from the service, so the
  // notice replaces the table entirely: 'not_connected', 'never_synced' and
  // 'no_spend_in_window' each have literally nothing to tabulate.
  const showTable = data && (data.state === 'ok' || data.state === 'no_ad_id_coverage');

  const rows: DisplayRow[] = useMemo(() => {
    if (!data) return [];
    const out: DisplayRow[] = data.rows.map((row) => ({ kind: 'data' as const, row }));
    if (data.totals) out.push({ kind: 'totals' as const, row: data.totals });
    return out;
  }, [data]);

  if (isError) {
    return (
      <EmptyState message={`Couldn't load the Facebook report: ${(error as Error)?.message ?? 'unknown error'}`} />
    );
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
            onRowClick={(r) => { if (r.kind === 'data' && r.row.id) onSelectCampaign(r.row.id); }}
            emptyState={<EmptyState message="No Facebook campaign spend in this window." />}
          />
          <p className="mt-2 text-[12px] text-ink-muted">
            * Attended is Dentally-only — a GoHighLevel booking alone cannot say
            whether someone turned up.
          </p>
        </DeferUntilVisible>
      )}

      {data.unmatchedLeads && unmatchedLeadsNote(data.unmatchedLeads)}

      {data.excludedAccounts.length > 0 && (
        <Note>
          {data.excludedAccounts.length === 1
            ? 'One Meta account is'
            : `${data.excludedAccounts.length} Meta accounts are`}
          {' '}not shown here because Elevate does not yet report in{' '}
          {data.excludedAccounts.length === 1 ? 'its' : 'their'} currency:{' '}
          {data.excludedAccounts.map((a, i) => (
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
