'use client';
// One row per open day. Shown only to tenants that have at least one — an
// always-empty tab is noise for everyone else, which is why the tab itself is
// conditional in FacebookReportScreen rather than this component rendering a
// placeholder.
import { DataGrid, type GridColumn } from '../../_shared/DataGrid';
import { money, money0, num, DASH } from '../../_shared/format';
import { useFacebookLeadPerformance } from '../hooks';
import type { FacebookOpenDayEvent } from '../api';

const COLUMNS: GridColumn<FacebookOpenDayEvent>[] = [
  {
    key: 'event',
    header: 'Open day',
    render: (r) => (
      <div>
        <div>{r.name ?? 'Untitled'}</div>
        <div className="text-[12px] text-ink-2">
          {r.eventDate ?? 'no date'} · {num(r.campaigns)} campaign{r.campaigns === 1 ? '' : 's'}
          {r.practices > 0 ? ` · ${num(r.practices)} practice${r.practices === 1 ? '' : 's'}` : ''}
        </div>
      </div>
    ),
  },
  { key: 'spend', header: 'Spend', align: 'right', render: (r) => money0(r.spendPence) },
  {
    key: 'leads',
    header: 'Leads',
    align: 'right',
    // The denominator AND how much of it Meta can account for, so a reader can
    // see when a cost per lead rests on leads the ads cannot be shown to have
    // bought.
    render: (r) => (
      <div>
        {num(r.leads)}
        <div className="text-[12px] text-ink-2">{num(r.attributedLeads)} attributed</div>
      </div>
    ),
  },
  { key: 'booked', header: 'Booked', align: 'right', render: (r) => num(r.booked) },
  { key: 'patients', header: 'Patients', align: 'right', render: (r) => num(r.accepted) },
  { key: 'cpl', header: 'Cost / lead', align: 'right', render: (r) => money(r.cplPence) },
  { key: 'cpa', header: 'Cost / patient', align: 'right', render: (r) => money(r.cpaPence) },
  { key: 'collected', header: 'Collected', align: 'right', render: (r) => (r.paidPence > 0 ? money0(r.paidPence) : DASH) },
];

export function FacebookOpenDaysTab() {
  const { data } = useFacebookLeadPerformance();
  const events = data?.openDays.events ?? [];
  return (
    <DataGrid
      columns={COLUMNS}
      rows={events}
      rowKey={(r) => r.openDayId}
      emptyState="No open day was active in this period."
    />
  );
}
