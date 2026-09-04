'use client';
// Google report — Ad groups tab. `campaignId` is an OPTIONAL filter threaded
// down from the URL (omitted -> every ad group in the window across every
// campaign); clicking a row calls `onSelectAdGroup`, which the parent
// GoogleReportScreen turns into a `?tab=ads&parentId=…` filter switch that
// ALSO applies to the Keywords tab (ads and keywords are siblings under an
// ad group — see the file header on google-report.service.js).
//
// No bucket rows (Facebook's ../facebook/components/FacebookAdSetsTab.tsx
// has notIdentified/unmatchedLeads because leads must reconcile back up to
// the campaign total; Google's rows are already fully attributed, so there
// is nothing to bucket). Rows carry campaignName even when a campaign filter
// is active, shown as a muted subtitle under the ad group name — most useful
// on the unfiltered listing (docs/API.md: "so an unfiltered listing across
// campaigns stays readable"), harmless as a confirmation when filtered.
import { EmptyState, SkeletonTable } from '@/components/ui';
import { DeferUntilVisible } from '@/components/DeferUntilVisible';
import { formatDate } from '@/lib/format';
import type { UseQueryResult } from '@tanstack/react-query';
import { AdMetricTable, type Column } from '../../_shared/AdMetricTable';
import { money, ctr, num } from '../../_shared/format';
import { GoogleStateNotice } from './GoogleStateNotice';
import type { GoogleAdGroupsPayload, GoogleRow } from '../api';

// Calm, factual prose — never an error/warning colour.
function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-panel border border-border bg-bg px-3 py-2 text-[12.5px] leading-relaxed text-ink-muted">
      {children}
    </p>
  );
}

const COLUMNS: Column<GoogleRow>[] = [
  {
    key: 'name',
    header: 'Ad group',
    align: 'left',
    render: (r) => (
      <span className="font-medium text-brand">
        {r.name ?? r.id ?? 'Unnamed ad group'}
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
];

export function GoogleAdGroupsTab({
  query,
  onSelectAdGroup,
}: {
  query: UseQueryResult<GoogleAdGroupsPayload>;
  onSelectAdGroup: (id: string) => void;
}) {
  const { data, isLoading, isError, error } = query;

  const showTable = data && data.state === 'ok';

  if (isError) {
    return <EmptyState message={`Couldn't load ad groups: ${(error as Error)?.message ?? 'unknown error'}`} />;
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
            rows={data.rows}
            onRowClick={(r) => { if (r.id) onSelectAdGroup(r.id); }}
            emptyState={<EmptyState message="No Google ad group spend in this window." />}
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
