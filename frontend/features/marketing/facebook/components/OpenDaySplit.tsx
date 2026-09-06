'use client';
// ============================================================================
// Always-on vs open days, with the events beneath.
//
// The last row says "= Meta total". That is an ARITHMETIC IDENTITY, not a
// label: ad_open_day_campaigns' primary key lets a campaign belong to at most
// one event, so always-on is exactly "not mapped" and the two buckets cover
// every campaign once. The backend asserts it metric-for-metric
// (test/open-day-split.test.mjs); this component only has to render it without
// quietly dropping a column.
//
// DISPLAY ONLY. The mapping lives on the Integrations page, in the Meta tile,
// beside the other mappings — it is setup, done once, and a report page that
// also edits its own inputs is two things at once. A tenant with nothing
// mapped sees one line here inviting them over, and nothing else changes.
// ============================================================================
import Link from 'next/link';
import { DataGrid, type GridColumn } from '../../_shared/DataGrid';
import { SectionHead } from '../../_shared/StatRail';
import { money, money0, num } from '../../_shared/format';
import type { FacebookOpenDayBucket, FacebookOpenDaySplit } from '../api';

type SplitRow = {
  key: string;
  label: string;
  sub: string | null;
  tone: 'bucket' | 'event' | 'total';
  row: FacebookOpenDayBucket;
};

// The two buckets sum to this. Computed here rather than read from the cards
// above because the cards' spend is a PRACTICE-grain read and this table is
// campaign-grain — showing one as the total of the other would be a
// reconciliation that only looks right.
function totalOf(split: FacebookOpenDaySplit): FacebookOpenDayBucket {
  const a = split.alwaysOn;
  const o = split.openDays;
  const spendPence = a.spendPence + o.spendPence;
  const leads = a.leads + o.leads;
  const booked = a.booked + o.booked;
  const accepted = a.accepted + o.accepted;
  // Null, not 0, on a zero denominator — a cost per nothing is unknowable.
  const per = (units: number) => (units > 0 ? Math.round(spendPence / units) : null);
  return {
    spendPence,
    impressions: a.impressions + o.impressions,
    clicks: a.clicks + o.clicks,
    conversions: a.conversions + o.conversions,
    leads, booked, accepted,
    paidPence: a.paidPence + o.paidPence,
    cplPence: per(leads),
    cpbPence: per(booked),
    cpaPence: per(accepted),
  };
}

const COLUMNS: GridColumn<SplitRow>[] = [
  {
    key: 'label',
    header: '',
    render: (r) => (
      <div className={r.tone === 'event' ? 'pl-6' : undefined}>
        <div className={r.tone === 'total' ? 'font-medium' : undefined}>{r.label}</div>
        {r.sub && <div className="text-[12px] text-ink-2">{r.sub}</div>}
      </div>
    ),
  },
  { key: 'spend', header: 'Spend', align: 'right', render: (r) => money0(r.row.spendPence) },
  { key: 'leads', header: 'Leads', align: 'right', render: (r) => num(r.row.leads) },
  { key: 'booked', header: 'Booked', align: 'right', render: (r) => num(r.row.booked) },
  { key: 'patients', header: 'Patients', align: 'right', render: (r) => num(r.row.accepted) },
  { key: 'cpl', header: 'Cost / lead', align: 'right', render: (r) => money(r.row.cplPence) },
  { key: 'cpa', header: 'Cost / patient', align: 'right', render: (r) => money(r.row.cpaPence) },
];

export function OpenDaySplit({ split }: { split: FacebookOpenDaySplit }) {
  const mapped = split.events.length > 0 || split.openDays.spendPence > 0;

  // Nothing mapped: one line, no table. Open days cost a tenant who does not
  // run them a sentence, not a reshaped page.
  if (!mapped) {
    return (
      <p className="text-[13px] text-ink-2">
        Running open days?{' '}
        <Link href="/integrations" className="text-brand underline">
          Mark which campaigns promoted them
        </Link>{' '}
        to see them separately from your always-on advertising.
      </p>
    );
  }

  const rows: SplitRow[] = [
    { key: 'always-on', label: 'Always-on', sub: null, tone: 'bucket', row: split.alwaysOn },
    { key: 'open-days', label: 'Open days', sub: null, tone: 'bucket', row: split.openDays },
    ...split.events.map((e) => ({
      key: e.openDayId,
      label: e.name ?? 'Untitled',
      sub: [
        e.eventDate ?? 'no date',
        `${num(e.campaigns)} campaign${e.campaigns === 1 ? '' : 's'}`,
        // Zero practices means no mapped campaign's account is mapped to a
        // practice. Say nothing rather than "0 practices", which reads as a
        // finding about the event rather than a gap in the account mapping.
        e.practices > 0 ? `${num(e.practices)} practice${e.practices === 1 ? '' : 's'}` : null,
      ].filter(Boolean).join(' · '),
      tone: 'event' as const,
      row: e,
    })),
    { key: 'total', label: '= Meta total', sub: null, tone: 'total', row: totalOf(split) },
  ];

  return (
    <div className="flex flex-col gap-2">
      <SectionHead
        title="Always-on and open days"
        note="Every campaign sits in exactly one of these, so the two add up to the whole."
        right={
          <Link href="/integrations" className="text-[13px] text-brand underline">
            Manage open days
          </Link>
        }
      />
      <DataGrid
        columns={COLUMNS}
        rows={rows}
        rowKey={(r) => r.key}
        rowTone={(r) => (r.tone === 'event' ? 'muted' : 'default')}
        emptyState={null}
      />
      {split.events.length === 0 && (
        <p className="text-[12px] text-ink-2">
          Spend is mapped to an open day, but no event was active in this period.
        </p>
      )}
    </div>
  );
}
