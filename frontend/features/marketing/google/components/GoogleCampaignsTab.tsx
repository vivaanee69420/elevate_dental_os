'use client';
// Google report — Campaigns tab. Mirrors
// ../facebook/components/FacebookCampaignsTab.tsx: clicking a row calls
// `onSelectCampaign`, which the parent GoogleReportScreen turns into a
// `?tab=adgroups&campaignId=…` filter switch.
//
// No coverage notice, no unmatched-leads note, no CPL/CPB/CPA columns —
// Google's rows are already fully attributed by the platform itself (see
// google-report.service.js's file header, point 1 and point 5). Two columns
// the Facebook tab does not have instead: Conversions and Cost / conversion,
// both Google's own tracked figures, present at every grain.
import { useMemo } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { EmptyState, SkeletonTable } from '@/components/ui';
import { DeferUntilVisible } from '@/components/DeferUntilVisible';
import { formatDate } from '@/lib/format';
import { AdMetricTable, type Column } from '../../_shared/AdMetricTable';
import { money, ctr, num } from '../../_shared/format';
import { GoogleStateNotice } from './GoogleStateNotice';
import type { GoogleCampaignsPayload, GoogleRow } from '../api';

type DisplayRow = { kind: 'data'; row: GoogleRow } | { kind: 'totals'; row: GoogleRow };

// Google's own campaign status (ENABLED, PAUSED, REMOVED…) as the sync
// stamped it on the latest day in the window. Only the not-running ones are
// worth a chip — same reasoning as the Facebook tab's StatusChip, just keyed
// on Google's "ENABLED" rather than Meta's "ACTIVE".
function StatusChip({ status }: { status: string | null }) {
  if (!status || status.toUpperCase() === 'ENABLED') return null;
  const label = status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
  return (
    <span
      className="ml-2 rounded-full border border-border bg-bg px-2 py-0.5 align-middle text-[11px] font-normal text-ink-muted"
      title="Campaign status reported by Google on the most recent day in this period."
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
  { key: 'conversions', header: 'Conversions', align: 'right', render: (r) => num(r.row.conversions) },
  { key: 'costPerConversion', header: 'Cost / conversion', align: 'right', render: (r) => money(r.row.costPerConversionPence) },
];

export function GoogleCampaignsTab({
  query,
  onSelectCampaign,
}: {
  query: UseQueryResult<GoogleCampaignsPayload>;
  onSelectCampaign: (id: string) => void;
}) {
  const { data, isLoading, isError, error } = query;

  // The three non-ok states all return zero rows from the service, so the
  // notice replaces the table entirely — same shape as the Facebook tab's
  // showTable gate, minus the no_ad_id_coverage case Google does not have.
  const showTable = data && data.state === 'ok';

  const rows: DisplayRow[] = useMemo(() => {
    if (!data) return [];
    const out: DisplayRow[] = data.rows.map((row) => ({ kind: 'data' as const, row }));
    if (data.totals) out.push({ kind: 'totals' as const, row: data.totals });
    return out;
  }, [data]);

  if (isError) {
    return (
      <EmptyState message={`Couldn't load the Google report: ${(error as Error)?.message ?? 'unknown error'}`} />
    );
  }
  if (isLoading && !data) return <SkeletonTable rows={8} cols={8} />;
  if (!data) return null;

  return (
    <div className="flex flex-col gap-4">
      <GoogleStateNotice state={data.state} />

      {data.windowClamped && (
        <Note>
          Ad group, ad and keyword detail is kept for 92 days. This period reaches further back
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
            emptyState={<EmptyState message="No Google campaign spend in this window." />}
          />
        </DeferUntilVisible>
      )}

      {data.excludedAccounts.length > 0 && (
        <Note>
          {data.excludedAccounts.length === 1
            ? 'One Google account is'
            : `${data.excludedAccounts.length} Google accounts are`}
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
