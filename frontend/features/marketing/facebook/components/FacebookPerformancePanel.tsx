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
import { EmptyState, SkeletonTable } from '@/components/ui';
import { formatDate } from '@/lib/format';
import { DataGrid, type GridColumn } from '../../_shared/DataGrid';
import { StatRail, FootNote, SectionHead, type Stat } from '../../_shared/StatRail';
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
import SpendFreshnessNote from '@/features/marketing/_shared/SpendFreshnessNote';

type Bucket = 'leads' | 'booked' | 'accepted';

const BUCKET_LABEL: Record<Bucket, string> = {
  leads: 'Leads',
  booked: 'Booked',
  accepted: 'Acquired patients',
};

const practiceKey = (id: string | null) => id ?? '__unmapped__';

export function FacebookPerformancePanel() {
  const { data, isLoading, isError, error } = useFacebookLeadPerformance();
  const selected = useSelectedYmdWindow();
  const [compare, setCompare] = useState<CompareWindow | null>(null);
  const { data: previous } = useFacebookLeadPerformanceFor(compare);

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

  const leadRows = useMemo(() => {
    let rows = (data?.leads ?? []).filter((l) => includeExisting || l.is_new_patient);
    if (campaignFilter) rows = rows.filter((l) => l.campaign_id === campaignFilter);
    if (openBucket === 'booked') return rows.filter((l) => l.booked);
    if (openBucket === 'accepted') return rows.filter((l) => l.accepted);
    return rows;
  }, [data?.leads, openBucket, includeExisting, campaignFilter]);

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
      <p className="text-[12px] leading-relaxed text-ink-muted">
        {num(data.coverage.uncategorisedLeads)} leads sit in pipelines that have not been
        categorised, {num(data.coverage.uncategorisedAttributedLeads)} of them carrying Meta
        attribution. Categorise them on the Integrations page to include them here.
      </p>
    )
    : null;

  if (!total || (total.leads === 0 && total.spendPence === 0)) {
    return (
      <div className="flex flex-col gap-2">
        <EmptyState message="No Meta spend and no attributed leads landed in the selected window." />
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

  const leadCols: GridColumn<FacebookLeadRow>[] = [
    { key: 'name', header: 'Name', render: (r) => r.name ?? DASH },
    { key: 'practice', header: 'Practice', render: (r) => r.practice_name ?? DASH },
    { key: 'campaign', header: 'Campaign', render: (r) => r.campaign_name ?? DASH },
    { key: 'at', header: 'Lead', render: (r) => (r.lead_at ? formatDate(r.lead_at) : DASH) },
    { key: 'treatment', header: 'Treatment', render: (r) => r.treatment ?? DASH },
    { key: 'booked', header: 'Booked', render: (r) => (r.booked ? 'Yes' : DASH) },
    {
      key: 'paid',
      header: 'Paid',
      align: 'right',
      // The money behind the Yes, so the reader can see the threshold working
      // rather than take it on trust.
      render: (r) => (r.paid_pence > 0 ? money0(r.paid_pence) : DASH),
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

      <StatRail stats={stats} />

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

      {split && <OpenDaySplit split={split} />}

      {/* WHAT THE POOL LEAVES OUT. A lead reaches this page only if its
          GoHighLevel pipeline has been categorised, which removed 212
          Meta-attributed leads (-11.5%) for the reference org the day that
          rule shipped. Stating the loss, with the route to fixing it, is the
          whole justification for accepting it — a number nobody can see is a
          number nobody will fix. Rendered only when there is something to
          report, and never when the server did not send the figure. */}
      {coverageNote}

      {openBucket && (
        <div className="flex flex-col gap-2">
          <SectionHead
            title={`${BUCKET_LABEL[openBucket]} · ${num(leadRows.length)}`}
            right={(
              <button
                type="button"
                className="text-[13px] text-ink-2 underline"
                onClick={() => { setOpenBucket(null); setCampaignFilter(null); }}
              >
                Hide
              </button>
            )}
          />
          <DataGrid
            columns={leadCols}
            rows={leadRows}
            rowKey={(r, i) => `${r.contact_id ?? 'x'}-${i}`}
            emptyState="No leads in this bucket."
          />
        </div>
      )}

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

      <FootNote>
        A patient is a lead whose settled payments, net of refunds, exceed
        {' '}{money(data.acceptanceMinPaidPence)} from the day the lead arrived — the same rule the
        Google report uses, so the two pages&rsquo; cost per patient mean the same thing. This
        differs from the Campaigns tab&rsquo;s patient count, which asks only whether the lead
        exists in Dentally. Acceptance is counted to date rather than within the period, so a past
        period&rsquo;s figure improves as its leads convert.
      </FootNote>
    </div>
  );
}
