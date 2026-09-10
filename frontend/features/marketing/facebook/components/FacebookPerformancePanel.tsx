'use client';
// ============================================================================
// Facebook — blended cost per lead / booking / acquired patient.
//
// WHAT MAKES THIS DIFFERENT FROM THE CAMPAIGN TAB'S "Patients" COLUMN, and why
// both exist. The tab's figure comes from ad_meta_funnel's `converted`: the
// lead resolved to a Dentally patient record. This panel's `accepted` comes
// from ad_meta_lead_ledger (000167): the lead has actually PAID, net of
// refunds, above the consultation floor. Measured live for Jun-Aug 2026 the
// two were 267 and 33 — the matched rule reported more patients than there
// were bookings, and made Meta's cost per patient read ~8x cheaper than the
// Google page beside it. This panel is the figure to compare across platforms;
// the tab's is "how many of these leads exist in Dentally at all".
//
// The acceptance threshold is printed from the PAYLOAD, never from a literal
// here: the server decided it, and a second copy in the UI is a copy free to
// disagree with the number it is labelling.
//
// COMPARISON POLARITY. The arrow points the way the number moved; the COLOUR
// carries the metric's meaning. A rising cost per patient is a RED up-arrow,
// and spend is neutral because a practice controls it and a rise is neither
// good nor bad on its own. Painting a cost rise green would have the card
// congratulate the practice for getting worse.
// ============================================================================
import { useMemo, useState } from 'react';
import { Chip, EmptyState, SkeletonTable } from '@/components/ui';
import { formatDate } from '@/lib/format';
import { DataGrid, type GridColumn } from '../../_shared/DataGrid';
import { FootNote, SectionHead, type Stat } from '../../_shared/StatRail';
import { HeadlineCard, type HeadlineKpi } from '@/features/overview/components/HeadlineCard';
import { DetailModal } from '../../_shared/DetailModal';
import { CampaignHighlights } from '../../_shared/CampaignHighlights';
import { money, money0, num, multiple, DASH } from '../../_shared/format';
import { computeDelta, sourcesComparable, type Polarity } from '../../_shared/compare';
import { DeltaBadge, DeltaInline } from '../../_shared/DeltaBadge';
import { ComparePicker, type CompareWindow } from '../../_shared/ComparePicker';
import {
  useFacebookLeadPerformance, useFacebookLeadPerformanceFor, useSelectedYmdWindow,
} from '../hooks';
import { OpenDaySplit } from './OpenDaySplit';
import type { FacebookLeadPractice, FacebookLeadRow } from '../api';
import type { AdBucket } from '../../_shared/AdBucketFilter';
import SpendFreshnessNote from '@/features/marketing/_shared/SpendFreshnessNote';

/** "5 Sep" — a table cell has no room for 05/09/2026, and the year is the same
 *  on every row of a period anyway. Formatted in London, because these are
 *  London days and a UTC render shifts the late-evening ones back by one. */
function shortDay(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/London' });
}


// The page's cards, from the stats these panels already build. Same component
// as the Business Hub and Ad performance, so the three surfaces look like one
// product — and the panel keeps its OWN badge, which carries the comparability
// guard a rebuilt one here would drop.
function asCards(rows: Stat[]): HeadlineKpi[] {
  return rows.map((r) => ({
    label: r.label,
    value: String(r.value ?? ''),
    sub: typeof r.sub === 'string' ? r.sub : '',
    chip: null,
    badge: r.badge,
    onClick: r.onClick,
    active: r.active,
  }));
}

type Bucket = 'leads' | 'booked' | 'accepted';

const BUCKET_LABEL: Record<Bucket, string> = {
  leads: 'Leads',
  booked: 'Booked',
  accepted: 'Acquired patients',
};

const practiceKey = (id: string | null) => id ?? '__unmapped__';

// NEWEST ENQUIRY FIRST, because the server's order is not an order.
//
// ad_meta_lead_ledger (000171) is `SELECT DISTINCT ON (l.contact_id) ... ORDER
// BY l.contact_id`, so rows arrive sorted by a UUID — which is to say
// shuffled. Rendered unsorted, the Enquired column showed the same handful of
// dates again and again all the way down the list with no order to them, and
// the reader could not tell whether that was the data or the table. Sorting on
// the INSTANT (the column's own sortBy), not the printed "5 Sep".
const LEAD_SORT = { key: 'at', dir: 'desc' } as const;

/** One side of the always-on / open-day split inside the leads dialog. */
function LeadSection({
  title, count, rows, columns, maxHeightClass,
}: {
  title: string;
  count: number;
  rows: FacebookLeadRow[];
  columns: GridColumn<FacebookLeadRow>[];
  maxHeightClass: string;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="flex items-baseline gap-2 text-[13px] font-semibold text-ink">
        {title}
        <span className="text-[12px] font-normal tabular-nums text-ink-muted">{num(count)}</span>
      </h3>
      <DataGrid
        columns={columns}
        rows={rows}
        rowKey={(r, i) => `${r.contact_id ?? 'x'}-${i}`}
        emptyState="No leads in this section."
        defaultSort={LEAD_SORT}
        maxHeightClass={maxHeightClass}
      />
    </section>
  );
}

export function FacebookPerformancePanel({ bucket = 'all' }: { bucket?: AdBucket }) {
  const { data, isLoading, isError, error } = useFacebookLeadPerformance(bucket);
  const selected = useSelectedYmdWindow();
  const [compare, setCompare] = useState<CompareWindow | null>(null);
  // The comparison period is asked for the SAME bucket, so the arrows never
  // compare an open-day fortnight against everything that ran beside it.
  const { data: previous } = useFacebookLeadPerformanceFor(compare, bucket);

  // Both figures arrive in one payload, so this toggle is free and the two can
  // never be the output of two differently-written queries.
  const [includeExisting, setIncludeExisting] = useState(false);
  const [openBucket, setOpenBucket] = useState<Bucket | null>(null);
  const [campaignFilter, setCampaignFilter] = useState<string | null>(null);
  const [showPractices, setShowPractices] = useState(false);

  const practices = (includeExisting ? data?.practicesAll : data?.practices) ?? [];
  const campaigns = (includeExisting ? data?.campaignsAll : data?.campaigns) ?? [];
  const total = includeExisting ? data?.totalAll : data?.total;
  const split = includeExisting ? data?.openDaysAll : data?.openDays;
  const prevTotal = includeExisting ? previous?.totalAll : previous?.total;

  const prevPractices = useMemo(
    () => new Map(((includeExisting ? previous?.practicesAll : previous?.practices) ?? [])
      .map((p) => [practiceKey(p.practiceId), p])),
    [previous, includeExisting],
  );

  // Money collected from this window's leads, TO DATE — the same cohort rule
  // acceptance uses, so a July lead who paid in August counts on July.
  const collectedPence = useMemo(
    () => campaigns.reduce((a, c) => a + c.paidPence, 0),
    [campaigns],
  );

  // A LEAD IS A LEAD WHOEVER IT CAME FROM — the new-patient gate belongs on
  // OUTCOMES only, and applying it to the lead list is what made this drawer
  // disagree with the card that opened it.
  //
  // Measured live (GM Dental Group, Rochester, August 2026): the card read
  // "342 leads" and the drawer listed 54, because practiceLeadPerformance
  // counts `row.leads += 1` for every ledger row while this filtered the list
  // down to is_new_patient first. Same rule as lead-performance.js's own
  // eligibleForOutcome, whose comment says it in as many words: "Note it gates
  // OUTCOMES only." Booked and accepted keep the gate, which is why their
  // cards say "(new patients)" and the leads card does not.
  const leadRows = useMemo(() => {
    let rows = data?.leads ?? [];
    if (campaignFilter) rows = rows.filter((l) => l.campaign_id === campaignFilter);
    const eligible = (l: FacebookLeadRow) => includeExisting || l.is_new_patient;
    if (openBucket === 'booked') return rows.filter((l) => l.booked && eligible(l));
    if (openBucket === 'accepted') return rows.filter((l) => l.accepted && eligible(l));
    return rows;
  }, [data?.leads, openBucket, includeExisting, campaignFilter]);

  // The two sides of the open-day split, as two lists rather than one list
  // with a column to squint at. The discriminator is the lead's OWN
  // open_day_id — its GoHighLevel pipeline, the same field the split beneath
  // the cards buckets on — never the campaign it happens to be attributed to.
  const alwaysOnRows = useMemo(() => leadRows.filter((l) => !l.open_day_id), [leadRows]);
  const openDayRows = useMemo(() => leadRows.filter((l) => l.open_day_id), [leadRows]);

  if (isLoading) return <SkeletonTable rows={4} />;
  // A FAILED REQUEST MUST SAY SO. `return null` here is what hid a malformed
  // URL: the request 404d, React Query errored, and the page simply had no
  // cards — which looks exactly like a page designed without cards. An empty
  // state that names the failure turns a silent absence into a report.
  if (isError || !data) {
    return (
      <EmptyState
        message={`Could not load Meta performance${error instanceof Error ? `: ${error.message}` : ''}`}
      />
    );
  }
  if (data.state === 'not_connected') {
    return (
      <EmptyState message="Meta Ads is not connected. Connect a Meta ad account on the Integrations page to see cost per lead, booking and acquired patient." />
    );
  }
  // The sentence the pool switch owes the reader — see the render below. Built
  // once and shown in BOTH branches: the tenant whose report is entirely empty
  // because nothing is categorised is precisely the one who needs it.
  const coverageNote = data.coverage && data.coverage.uncategorisedLeads > 0
    ? (
      // The count and the route to fixing it. The explanation of what
      // "uncategorised" means was three lines the reader has to get past to
      // reach the tabs, and the link teaches it faster.
      <p className="text-[12px] text-ink-muted">
        {num(data.coverage.uncategorisedLeads)} leads not categorised
        {' '}({num(data.coverage.uncategorisedAttributedLeads)} with Meta attribution).{' '}
        <a href="/integrations" className="text-brand hover:underline">Categorise them</a>
      </p>
    )
    : null;

  if (!total || (total.leads === 0 && total.spendPence === 0)) {
    // WHICH emptiness this is. Under a bucket the window is very often not
    // empty at all — it is the filter that emptied it, and telling the reader
    // "nothing landed in the selected window" beside a window they can see has
    // spend in it sends them off widening a period that was never the problem.
    return (
      <div className="flex flex-col gap-2">
        <EmptyState message={
          bucket === 'openDays'
            ? 'No open day campaign ran, and no open day lead arrived, in the selected period. Switch the filter to All to see the always-on campaigns.'
            : bucket === 'alwaysOn'
              ? 'Every Meta campaign in this period is mapped to an open day, so there is nothing always-on to show. Switch the filter to All or Open days.'
              : 'No Meta spend and no attributed leads landed in the selected window.'
        } />
        {coverageNote}
      </div>
    );
  }

  const toggle = (b: Bucket) => {
    setCampaignFilter(null);
    setOpenBucket((cur) => (cur === b ? null : b));
  };

  // THE GUARD THAT STOPS A COMPARISON SHIPPING AS A LIE. A Meta lead is
  // identified STRUCTURALLY, by its ad_id resolving to a Meta campaign, so a
  // period before this org captured ad attribution holds ZERO Meta leads
  // beside real spend. Differencing that against a period with attribution
  // renders a spectacular improvement that is entirely a coverage cliff.
  // Presence, not proportion: 218 leads against 12 is a real change worth
  // showing; 218 against 0 is not a collapse in demand.
  const comparable = prevTotal
    ? sourcesComparable({ ghl: total.leads, callrail: 0 }, { ghl: prevTotal.leads, callrail: 0 })
    : true;

  // Keep the ARROW when the periods are not like for like — the number really
  // did move — but drop the good/bad colour, because "good" is a claim about
  // performance and performance is exactly what cannot be read across a cliff.
  const cardBadge = (
    pick: (t: NonNullable<typeof total>) => number | null,
    polarity: Polarity,
    format: (v: number | null) => string,
  ) => {
    if (!prevTotal) return undefined;
    const was = pick(prevTotal);
    return (
      <DeltaBadge
        delta={computeDelta(pick(total), was, comparable ? polarity : 'neutral')}
        previousLabel={format(was)}
      />
    );
  };

  const stats: Stat[] = [
    {
      // Spend is an input the practice controls, so a rise is neither good nor
      // bad on its own — neutral, never green-when-up.
      label: 'Meta spend',
      value: money0(total.spendPence),
      sub: `${num(total.clicks)} clicks · ${num(total.impressions)} impressions`,
      badge: cardBadge((t) => t.spendPence, 'neutral', money0),
    },
    {
      label: 'Cost per lead',
      value: money(total.cplPence),
      sub: `${num(total.leads)} leads`,
      badge: cardBadge((t) => t.cplPence, 'lower-better', money),
      onClick: () => toggle('leads'),
      active: openBucket === 'leads',
    },
    {
      label: 'Cost per booking',
      value: money(total.cpbPence),
      sub: `${num(total.booked)} booked in Dentally${includeExisting ? '' : ' (new patients)'}`,
      badge: cardBadge((t) => t.cpbPence, 'lower-better', money),
      onClick: () => toggle('booked'),
      active: openBucket === 'booked',
    },
    {
      label: 'Cost per patient',
      value: money(total.cpaPence),
      sub: `${num(total.accepted)} paid over ${money(data.acceptanceMinPaidPence)} to date${includeExisting ? '' : ' (new patients)'}`,
      badge: cardBadge((t) => t.cpaPence, 'lower-better', money),
      onClick: () => toggle('accepted'),
      active: openBucket === 'accepted',
    },
    {
      // The figure the panel exists to produce, so it gets the accent. TO
      // DATE, not within the period — acceptance is a cohort question.
      label: 'Collected',
      value: money0(collectedPence),
      sub: total.spendPence > 0
        ? `${multiple(collectedPence / total.spendPence)} of spend, to date`
        : 'To date, from this period’s leads',
      accent: true,
    },
  ];

  const rowDelta = (
    row: FacebookLeadPractice,
    pick: (p: FacebookLeadPractice) => number | null,
    polarity: Polarity,
  ) => {
    const was = prevPractices.get(practiceKey(row.practiceId));
    if (!was) return null;
    return <DeltaInline delta={computeDelta(pick(row), pick(was), comparable ? polarity : 'neutral')} />;
  };

  const practiceCols: GridColumn<FacebookLeadPractice>[] = [
    { key: 'practice', header: 'Practice', render: (r) => r.practiceName ?? 'Unmapped' },
    {
      key: 'spend',
      header: 'Spend',
      align: 'right',
      render: (r) => <>{money0(r.spendPence)} {rowDelta(r, (p) => p.spendPence, 'neutral')}</>,
    },
    { key: 'leads', header: 'Leads', align: 'right', render: (r) => num(r.leads) },
    { key: 'booked', header: 'Booked', align: 'right', render: (r) => num(r.booked) },
    { key: 'accepted', header: 'Patients', align: 'right', render: (r) => num(r.accepted) },
    {
      key: 'cpl',
      header: 'Cost / lead',
      align: 'right',
      render: (r) => <>{money(r.cplPence)} {rowDelta(r, (p) => p.cplPence, 'lower-better')}</>,
    },
    {
      key: 'cpa',
      header: 'Cost / patient',
      align: 'right',
      render: (r) => <>{money(r.cpaPence)} {rowDelta(r, (p) => p.cpaPence, 'lower-better')}</>,
    },
  ];

  // Rows are the UNION of both periods. The service builds a practice row only
  // where there was spend or a lead, so a practice that spent last period and
  // nothing this one is simply absent — and dropping it would hide the single
  // most interesting thing a comparison can show.
  const practiceRows: FacebookLeadPractice[] = compare
    ? [
      ...practices,
      ...[...prevPractices.values()]
        .filter((p) => !practices.some((c) => practiceKey(c.practiceId) === practiceKey(p.practiceId)))
        .map((p) => ({
          ...p,
          spendPence: 0, impressions: 0, clicks: 0,
          leads: 0, booked: 0, accepted: 0,
          cplPence: null, cpbPence: null, cpaPence: null,
        })),
    ]
    : practices;

  // Seven columns of mostly one-word answers made every row three lines tall
  // and told the reader very little. The practice and campaign move UNDER the
  // name as its second line — they describe the person, they are not separate
  // questions — which halves the width and lets each row sit on one line. Every
  // column is sortable, which is the point of a table over a list.
  //
  // `withOpenDay` is passed per SECTION, not read from the bucket. Inside the
  // always-on list every row is always-on by definition and the column could
  // only ever be a page of em dashes; inside the open-day list it is the one
  // thing that tells the events apart. Same reasoning that removed the blank
  // Reach column from the ad-set tier: an always-empty column is worse than
  // no column.
  const leadColsFor = (withOpenDay: boolean): GridColumn<FacebookLeadRow>[] => [
    {
      key: 'name', header: 'Person', width: 'w-[34%]',
      render: (r) => <span className="font-medium text-ink">{r.name ?? DASH}</span>,
      // Two facts about where the lead came from, on one quiet line.
      sub: (r) => [r.practice_name, r.campaign_name].filter(Boolean).join(' · ') || null,
      sortBy: (r) => r.name ?? null,
    },
    {
      key: 'at', header: 'Enquired', width: 'w-28',
      render: (r) => (r.lead_at ? shortDay(r.lead_at) : DASH),
      // Sorted on the INSTANT, not the printed text: "5 Sep" and "12 Aug" sort
      // alphabetically into nonsense.
      sortBy: (r) => (r.lead_at ? Date.parse(r.lead_at) : null),
    },
    {
      key: 'treatment', header: 'Treatment',
      render: (r) => r.treatment ?? DASH,
      sortBy: (r) => r.treatment ?? null,
    },
    // WHICH event, inside the open-day section. Never rendered in the
    // always-on one — see leadColsFor's header.
    ...(withOpenDay ? [{
      key: 'openday', header: 'Open day', width: 'w-40',
      render: (r: FacebookLeadRow) => (r.open_day_name
        ? <Chip colour="amber">{r.open_day_name}</Chip>
        : DASH),
      // Always-on sorts as an empty string so the events group together
      // rather than scattering through the list.
      sortBy: (r: FacebookLeadRow) => r.open_day_name ?? '',
    }] : []),
    {
      key: 'booked', header: 'Booked', width: 'w-24',
      // A tick, not the word "Yes". In a column where every visible row says
      // the same thing, the word is furniture; the tick is scannable.
      render: (r) => (r.booked ? <Chip colour="emerald">Booked</Chip> : DASH),
      sortBy: (r) => (r.booked ? 1 : 0),
    },
    {
      key: 'paid', header: 'Paid', align: 'right', width: 'w-24',
      // The money behind the tick, so the reader can see the threshold working
      // rather than take it on trust.
      render: (r) => (r.paid_pence > 0
        ? <span className="font-medium tabular-nums text-ink">{money0(r.paid_pence)}</span>
        : DASH),
      sortBy: (r) => r.paid_pence,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-[13px] text-ink-2 select-none">
          <input
            type="checkbox"
            checked={includeExisting}
            onChange={(e) => setIncludeExisting(e.target.checked)}
          />
          Include existing patients
        </label>
        <ComparePicker
          since={selected.since}
          until={selected.until}
          value={compare}
          onChange={setCompare}
        />
      </div>

      {/* WHAT THESE CARDS ARE COUNTING, in words, on the cards themselves.
          The pill row above says it too, but these figures get screenshotted
          and pasted into messages on their own — "£19.40, 97 leads" with no
          qualifier reads as the whole account's cost per lead, which under a
          bucket it is not. */}
      {bucket !== 'all' && (
        <p className="text-[12.5px] text-ink-2">
          {bucket === 'openDays'
            ? 'Open day campaigns only. Spend is the campaigns mapped to an event; leads are those that came through an open day pipeline.'
            : 'Always-on campaigns only — everything not mapped to an open day.'}
        </p>
      )}

      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]">
        {asCards(stats).map((c) => <HeadlineCard key={c.label} c={c} />)}
      </div>

      {/* The cards above are sums over the window, so a partial final day
          understates every one of them. Stated here, immediately under the
          figures it qualifies. */}
      <SpendFreshnessNote freshness={data?.freshness} />

      {compare && !comparable && (
        <p className="text-[12px] leading-relaxed text-ink-muted">
          These periods are not like for like — one of them has no Meta-attributed leads at all, so
          the arrows show how the numbers moved but not whether that is good or bad.
        </p>
      )}

      <CampaignHighlights
        campaigns={campaigns}
        onOpenCampaign={(id) => {
          setCampaignFilter(id);
          setOpenBucket('leads');
        }}
      />

      {/* ONE disclosure instead of five stacked headings, notes and toggles.
          Open days, the per-practice split, the uncategorised-lead count and
          the acceptance rule are all real and all secondary — stacked above
          the tabs they pushed the tables most readers come for off the screen,
          and the page read as a wall of explanation with a report somewhere
          underneath. Closed, this is one line. */}
      <details className="text-[12.5px] text-ink-muted">
        <summary className="cursor-pointer select-none py-1 marker:text-ink-muted hover:text-ink">
          Open days, by practice, and how a patient is counted
        </summary>
        <div className="mt-3 flex flex-col gap-4">
          {/* Only in the unfiltered view. Its last row is an arithmetic
              identity — "Always-on + Open days = Meta total" — and under a
              bucket one side is zero by construction, so the sum would still
              add up while quietly meaning the bucket rather than the total.
              Once the reader has picked a side, this table is the thing the
              filter replaced. */}
          {split && bucket === 'all' && <OpenDaySplit split={split} />}


          {coverageNote}

          <SectionHead
            title="By practice"
            right={(
              <button
                    type="button"
                    className="text-[13px] text-brand underline"
                    onClick={() => setShowPractices((v) => !v)}
              >
                    {showPractices ? 'Hide' : 'Show'}
              </button>
            )}
          />
          {showPractices && (
            <DataGrid
              columns={practiceCols}
              rows={practiceRows}
              rowKey={(r) => practiceKey(r.practiceId)}
              emptyState="No practice has Meta spend or leads in this window."
            />
          )}


          <p className="text-[12px] leading-snug text-ink-muted">
            A patient is a lead whose settled payments, net of refunds, exceed
            {' '}{money(data.acceptanceMinPaidPence)} from the day they arrived — the same rule the
            Google report uses. Counted to date, so a past period improves as its leads convert.
          </p>

        </div>
      </details>

      {/* The people behind a card open in a DIALOG, not inline. Expanding in
          place pushed everything below it down the page, so the reader lost
          their position in the report to see a list they opened for a moment —
          and on a long report the list could open off-screen entirely. */}
      <DetailModal
        open={openBucket !== null}
        title={openBucket ? `${BUCKET_LABEL[openBucket]} · ${num(leadRows.length)}` : ''}
        subtitle={campaignFilter ? `Campaign: ${campaignFilter}` : undefined}
        onClose={() => { setOpenBucket(null); setCampaignFilter(null); }}
      >
        {/* TWO LISTS, NOT ONE WITH A COLUMN. Always-on and open-day leads
            answer different questions — "what is the standing spend buying"
            and "what did that event bring in" — and interleaved they could
            only be told apart by reading a chip on every row.

            Sections appear only when BOTH sides have rows. Under a bucket
            filter, or for a tenant that has mapped no events, one side is
            empty by construction and a heading over the whole list plus an
            empty second heading would be furniture, not structure. */}
        {alwaysOnRows.length > 0 && openDayRows.length > 0 ? (
          <div className="flex flex-col gap-6">
            <LeadSection
              title="Always-on campaigns"
              count={alwaysOnRows.length}
              rows={alwaysOnRows}
              columns={leadColsFor(false)}
              maxHeightClass="max-h-[38vh]"
            />
            <LeadSection
              title="Open days"
              count={openDayRows.length}
              rows={openDayRows}
              columns={leadColsFor(true)}
              maxHeightClass="max-h-[38vh]"
            />
          </div>
        ) : (
          <DataGrid
            columns={leadColsFor(openDayRows.length > 0)}
            rows={leadRows}
            rowKey={(r, i) => `${r.contact_id ?? 'x'}-${i}`}
            emptyState="No leads in this bucket."
            defaultSort={LEAD_SORT}
            maxHeightClass="max-h-[68vh]"
          />
        )}
      </DetailModal>

    </div>
  );
}
