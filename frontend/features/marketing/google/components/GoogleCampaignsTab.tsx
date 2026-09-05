'use client';
// Google report — Campaigns tab. The only tier reading ad_metrics rather than
// a deep-grain table, which is why it has no `detail_not_synced` state and no
// 92-day clamp of its own.
//
// Clicking a row filters the Ad groups tab to that campaign — a real drill
// DOWN, one level, into the thing that has exactly one kind of child. (The Ad
// groups tab deliberately does not do the same, because an ad group has two
// kinds of child and picking one for the reader is what made the old
// behaviour feel arbitrary. See GoogleAdGroupsTab.)
import { EmptyState } from '@/components/ui';
import { DeferUntilVisible } from '@/components/DeferUntilVisible';
import type { UseQueryResult } from '@tanstack/react-query';
import { DataGrid, type GridColumn } from '../../_shared/DataGrid';
import { SectionHead } from '../../_shared/StatRail';
import { Chip, humanise } from '../../_shared/Bars';
import { num, DASH } from '../../_shared/format';
import { nameColumn, deliveryColumns, impressionShareColumn } from './columns';
import { GoogleTabFrame } from './GoogleTabFrame';
import type { GoogleCampaignsPayload, GoogleCampaignRow } from '../api';

export function GoogleCampaignsTab({
  query,
  onSelectCampaign,
}: {
  query: UseQueryResult<GoogleCampaignsPayload>;
  onSelectCampaign: (id: string) => void;
}) {
  const { data, isLoading, isError, error } = query;
  const rows = data?.rows ?? [];
  const maxSpend = rows.reduce((m, r) => Math.max(m, r.spendPence), 0);

  const columns: GridColumn<GoogleCampaignRow>[] = [
    {
      ...nameColumn<GoogleCampaignRow>('Campaign', maxSpend, 'Unnamed campaign'),
      // Channel type sits with the name because it is what makes the rest of
      // the row legible: a Performance Max campaign has no keywords and
      // frequently no impression share, and a reader who can see that label
      // reads those blanks as Google's design rather than as our gap.
      sub: (r) => (
        <span className="flex items-center gap-2">
          {r.channelType && <Chip>{humanise(r.channelType)}</Chip>}
          {r.status && /PAUSED|REMOVED/i.test(r.status) && <Chip tone="muted">{humanise(r.status)}</Chip>}
        </span>
      ),
    },
    ...deliveryColumns<GoogleCampaignRow>(),
    {
      key: 'calls', header: 'Calls', align: 'right', sortBy: (r) => r.phoneCalls ?? null,
      // Calls straight from a call extension, as Google counts them —
      // distinct from the CallRail figure in the rail above, which is a
      // deduplicated person. Two different questions, deliberately not
      // reconciled: one is "how many times did someone tap the number in the
      // ad", the other is "how many people rang us".
      render: (r) => (r.phoneCalls === null ? DASH : num(r.phoneCalls)),
    },
    impressionShareColumn<GoogleCampaignRow>(),
  ];

  return (
    <GoogleTabFrame
      state={data?.state}
      isLoading={isLoading}
      isError={isError}
      errorLabel={`Couldn't load campaigns: ${(error as Error)?.message ?? 'unknown error'}`}
      excludedAccounts={data?.excludedAccounts}
    >
      <div className="flex flex-col gap-2">
        <SectionHead
          title="Campaigns"
          note="Google's own delivery and tracked conversions. Click a campaign to see its ad groups."
          right={data?.totals && (
            <span className="text-[12px] text-ink-muted">
              {num(rows.length)} campaigns
            </span>
          )}
        />
        <DeferUntilVisible minHeight={360}>
          <DataGrid
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id ?? 'x'}
            emptyState={<EmptyState message="No Google campaign spend in this window." />}
            rowTone={(r) => (r.spendPence > 0 ? 'default' : 'muted')}
            // A campaign has exactly ONE kind of child, so a click can drill
            // into it without choosing on the reader's behalf. That is
            // precisely why the Ad groups tab below does NOT navigate: an ad
            // group has two kinds of child, and picking one is what made the
            // old behaviour feel arbitrary.
            onRowClick={(r) => { if (r.id) onSelectCampaign(r.id); }}
          />
        </DeferUntilVisible>
      </div>
    </GoogleTabFrame>
  );
}
