'use client';
// ============================================================================
// Google report — what the money bought.
//
// Replaces GoogleLeadPerformanceCards. The figures, the comparison arithmetic
// and every one of its guards are carried over unchanged; what is new is the
// PER-CAMPAIGN breakdown (migration 000165) and the presentation.
//
// WHAT THIS ANSWERS THAT THE PAGE COULD NOT ANSWER BEFORE
//
// Until now this section was practice-grain only, and said so at length: the
// service header stated that a per-campaign Google cost per patient was not
// buildable, because CallRail calls were believed to carry no ad linkage.
// They carry three — the campaign name, the bid keyword and the gclid, all
// captured from the click that produced the call. So the table below divides
// each campaign's OWN spend by its OWN leads, bookings and accepted patients,
// and sets the money those patients have actually paid beside it.
//
// Measured on live data while building it, and this is the whole point of the
// feature: one campaign took £3,616 and produced 52 leads, 1 accepted patient
// and £213 collected; another took £1,941, produced 28 leads, 5 accepted
// patients and £3,920 collected. At practice grain those two are one number.
//
// THE THREE THINGS THAT KEEP THIS HONEST
//
//  1. Leads that could not be tied to a campaign are shown, in their own row,
//     sorted last. 178 of 553 land there today. Dropping them would make the
//     campaign rows sum to fewer leads than the rail above and nothing would
//     say so.
//  2. That row's cost columns are blank, not £0.00 — it has no spend of its
//     own, and £0.00 per lead would read as the cheapest campaign in the table.
//  3. Coverage is stated in a footnote under the table, by resolution route,
//     so nobody has to take a cost figure on faith.
// ============================================================================
import { useMemo, useState } from 'react';
import { EmptyState, SkeletonTable } from '@/components/ui';
import { formatDate } from '@/lib/format';
import { DataGrid, type GridColumn } from '../../_shared/DataGrid';
import { StatRail, FootNote, SectionHead, type Stat } from '../../_shared/StatRail';
import { ShareBar, FunnelBar, Chip, humanise } from '../../_shared/Bars';
import { money, money0, num, multiple, DASH } from '../../_shared/format';
import {
  computeDelta, sourcesComparable, missingSources,
  type Polarity, type SourceCounts,
} from '../../_shared/compare';
import { DeltaBadge, DeltaInline } from '../../_shared/DeltaBadge';
import { ComparePicker, type CompareWindow } from '../../_shared/ComparePicker';
import {
  useGoogleLeadPerformance, useGoogleLeadPerformanceFor, useSelectedYmdWindow,
} from '../hooks';
import type { GoogleLeadPractice, GoogleLeadRow, GoogleCampaignPerformance } from '../api';

type Bucket = 'leads' | 'booked' | 'accepted';

const BUCKET_LABEL: Record<Bucket, string> = {
  leads: 'Leads',
  booked: 'Booked',
  accepted: 'Accepted patients',
};

// How each lead was tied to a campaign, in words. Shown in the drill-down so
// a reader can see the strength of the link on the row it applies to rather
// than only in aggregate: a keyword match names the exact search that bought
// the patient, a campaign match names only the campaign, and Performance Max
// can never do better than the second because it has no keywords at all.
const ROUTE_LABEL: Record<string, string> = {
  callrail_keyword: 'Keyword (call)',
  callrail_campaign: 'Campaign (call)',
  ghl_campaign: 'Campaign (form)',
};

// 'not callrail' is GoHighLevel, matching the Source column's own rule rather
// than testing for 'ghl' — a row with an unexpected source must land in the
// same bucket in the count and in the list it drills into.
function splitBySource(leads: GoogleLeadRow[] | undefined): SourceCounts {
  const rows = leads ?? [];
  const callrail = rows.filter((l) => l.source === 'callrail').length;
  return { callrail, ghl: rows.length - callrail };
}

// The service's own "unmapped" bucket is practiceId null — spend on an account
// with no practice mapping, or a lead whose practice could not be resolved. It
// is a real row that must line up across the two periods like any other, so it
// needs a stable key rather than being dropped by a null-keyed Map lookup.
const UNMAPPED = '__unmapped__';
const practiceKey = (practiceId: string | null) => practiceId ?? UNMAPPED;

// Per-practice source counts, so the like-for-like guard is judged PER ROW.
// Attribution coverage does not arrive everywhere at once — one practice can
// have had its GoHighLevel pipelines mapped months before another — so a
// single org-wide verdict would either suppress every practice's colour
// because one is uncovered, or bless a practice whose own history is missing.
function sourceCountsByPractice(leads: GoogleLeadRow[] | undefined): Map<string, SourceCounts> {
  const out = new Map<string, SourceCounts>();
  for (const l of leads ?? []) {
    const k = practiceKey(l.practiceId);
    const c = out.get(k) ?? { ghl: 0, callrail: 0 };
    if (l.source === 'callrail') c.callrail += 1; else c.ghl += 1;
    out.set(k, c);
  }
  return out;
}

const NO_SOURCES: SourceCounts = { ghl: 0, callrail: 0 };

export function GooglePerformancePanel() {
  // Owner-requested: off (the default) is the owner's own CPB/CPA definition
  // (new patients only); on counts every match regardless, to see the
  // exclusion's effect directly. Pure client-side state: the payload carries
  // BOTH sets from ONE fetch, so flipping this costs no request.
  const [includeExisting, setIncludeExisting] = useState(false);
  const { data, isLoading, isError } = useGoogleLeadPerformance();
  const [openBucket, setOpenBucket] = useState<Bucket | null>(null);
  const [showPractices, setShowPractices] = useState(false);

  // Comparison period. null = off, and while it is null the comparison query
  // is disabled, so a page nobody asked to compare fires no extra request.
  const selected = useSelectedYmdWindow();
  const [compare, setCompare] = useState<CompareWindow | null>(null);
  const { data: cmp, isFetching: cmpFetching } = useGoogleLeadPerformanceFor(compare);

  const rows = useMemo(() => {
    if (!data || !openBucket) return [];
    if (openBucket === 'leads') return data.leads;
    // booked/accepted here must mirror how the ON-SCREEN total was counted:
    // every match in "including existing" mode, only is_new_patient ones
    // otherwise — the same `eligible` gate the service applied.
    const eligible = (l: GoogleLeadRow) => includeExisting || l.isNewPatient;
    if (openBucket === 'booked') return data.leads.filter((l) => l.booked && eligible(l));
    return data.leads.filter((l) => l.accepted && eligible(l));
  }, [data, openBucket, includeExisting]);

  // Counted here rather than fetched: data.leads is the COMPLETE deduplicated
  // set (the repository pages the ledger RPC to exhaustion), and the leads
  // figure is the one number the existing-patients toggle does NOT gate, so
  // these two always sum to the headline in either toggle state.
  //
  // WHAT THIS IS NOT: a count of what each platform generated. Leads are
  // deduplicated by phone keeping the EARLIEST touch, so someone who called
  // and also filled in a form appears once, under whichever came first.
  const bySource = useMemo(() => splitBySource(data?.leads), [data]);
  const cmpBySource = useMemo(() => splitBySource(cmp?.leads), [cmp]);

  // Read with the SAME toggle as the on-screen figure. Reading `total` here
  // while the rail shows `totalAll` would compare new-patients-only against
  // everyone and present the difference as a change over time.
  const cmpTotal = compare && cmp?.state === 'ok'
    ? (includeExisting ? cmp.totalAll : cmp.total)
    : null;

  // Whether the two periods were measured the same way — see
  // ../../_shared/compare.ts's header for the live case that forced this (a
  // 95% "improvement" in cost per patient that was entirely an attribution
  // coverage cliff). When they were not, the arrows stay and the good/bad
  // colouring goes.
  const comparable = !cmpTotal || sourcesComparable(bySource, cmpBySource);
  const absentFromComparison = cmpTotal ? missingSources(bySource, cmpBySource) : [];
  const absentFromCurrent = cmpTotal ? missingSources(cmpBySource, bySource) : [];

  const cmpPractices = compare && cmp?.state === 'ok'
    ? (includeExisting ? cmp.practicesAll : cmp.practices)
    : null;
  const cmpByPractice = useMemo(() => {
    const m = new Map<string, GoogleLeadPractice>();
    for (const r of cmpPractices ?? []) m.set(practiceKey(r.practiceId), r);
    return m;
  }, [cmpPractices]);
  const srcNow = useMemo(() => sourceCountsByPractice(data?.leads), [data]);
  const srcThen = useMemo(() => sourceCountsByPractice(cmp?.leads), [cmp]);

  if (isError) return <EmptyState message="Couldn't load Google lead performance." />;
  if (isLoading && !data) return <SkeletonTable rows={2} cols={5} />;
  if (!data) return null;

  // Nothing to show at all (not_connected / never_synced / no_spend_in_window)
  // — the grain tabs below explain why via their own state notices; this
  // section stays quiet rather than repeating the same explanation above them.
  if (data.state !== 'ok' || !data.total || !data.totalAll) return null;

  const total = includeExisting ? data.totalAll : data.total;
  const practices = includeExisting ? data.practicesAll : data.practices;
  const campaigns = includeExisting ? data.campaignsAll : data.campaigns;

  // A leads figure of 0 is ambiguous between "quiet period" and "nobody has
  // mapped a GoHighLevel pipeline to Google yet"; this org's own map says
  // which. Spend is still real and shown — only the lead-derived figures are
  // unknown, and unknown is not the same as wrong.
  if (!data.googlePipelinesMapped) {
    return (
      <div className="flex flex-col gap-3">
        <StatRail stats={[
          { label: 'Google spend', value: money0(total.spendPence), sub: 'All practices, this period' },
          { label: 'Cost per lead', value: DASH, sub: 'Attribution not configured' },
          { label: 'Cost per booking', value: DASH, sub: 'Attribution not configured' },
          { label: 'Cost per patient', value: DASH, sub: 'Attribution not configured' },
        ]}
        />
        <FootNote>
          Cost per lead, per booking and per accepted patient are not shown yet — no GoHighLevel
          pipeline has been mapped to Google Ads for this organisation, so leads cannot be
          attributed.{' '}
          <a href="/settings/ad-attribution" className="text-brand hover:underline">
            Set up ad attribution
          </a>{' '}
          to sort pipelines into Google and Facebook.
        </FootNote>
      </div>
    );
  }

  const toggle = (b: Bucket) => setOpenBucket((cur) => (cur === b ? null : b));

  // Total collected across every campaign row. Derived here rather than
  // returned as its own total because the campaign rows ARE the population —
  // computing it a second way server-side would be a second thing to keep in
  // step with this one.
  const collectedPence = campaigns.reduce((n, c) => n + c.paidPence, 0);

  // One badge builder for every rail cell, so a metric's polarity is declared
  // once at the call site and null/zero handling cannot differ between them.
  // `pick` reads the SAME field from both periods — two different accessors
  // is how a cell ends up comparing cost-per-lead against cost-per-booking.
  const badge = (pick: (t: GoogleLeadPractice) => number | null, polarity: Polarity) => {
    if (!compare) return undefined;
    // Still in flight. Deliberately NOT the "no comparison" chip: that states
    // a fact about the data, and "we have not asked yet" is not that fact.
    if (cmpFetching && !cmpTotal) {
      return <span className="text-[11px] text-ink-muted">comparing…</span>;
    }
    const previous = cmpTotal ? pick(cmpTotal) : null;
    // Polarity turns a direction into good or bad news. Withholding it when
    // the periods are not like-for-like leaves the arrow and the percentage —
    // both facts — without the verdict, which is the part that would be wrong.
    const delta = computeDelta(pick(total), previous, comparable ? polarity : 'neutral');
    return <DeltaBadge delta={delta} previousLabel={money(previous)} />;
  };

  const stats: Stat[] = [
    // Spend is NEUTRAL, never green-when-up: it is an input the practice
    // controls, so a rise is neither good nor bad on its own. The COST cells
    // are 'lower-better', which is why a rising cost per patient shows a RED
    // up-arrow — see ../../_shared/compare.ts.
    {
      label: 'Google spend',
      value: money0(total.spendPence),
      sub: `${num(total.clicks)} clicks · ${num(total.impressions)} impressions`,
      badge: badge((t) => t.spendPence, 'neutral'),
    },
    {
      label: 'Cost per lead',
      value: money(total.cplPence),
      sub: `${num(total.leads)} leads · ${num(bySource.ghl)} form · ${num(bySource.callrail)} call`,
      badge: badge((t) => t.cplPence, 'lower-better'),
      onClick: () => toggle('leads'),
      active: openBucket === 'leads',
    },
    {
      label: 'Cost per booking',
      value: money(total.cpbPence),
      sub: `${num(total.booked)} booked in Dentally${includeExisting ? '' : ' (new patients)'}`,
      badge: badge((t) => t.cpbPence, 'lower-better'),
      onClick: () => toggle('booked'),
      active: openBucket === 'booked',
    },
    {
      label: 'Cost per patient',
      value: money(total.cpaPence),
      // The threshold comes from the payload, never a literal here: the server
      // decided it, and a second copy in the UI is a copy that can disagree
      // with the number it is labelling.
      sub: `${num(total.accepted)} paid over ${money(data.acceptanceMinPaidPence)} to date${includeExisting ? '' : ' (new patients)'}`,
      badge: badge((t) => t.cpaPence, 'lower-better'),
      onClick: () => toggle('accepted'),
      active: openBucket === 'accepted',
    },
    {
      // The figure the whole report exists to produce, so it gets the accent
      // and the last word. TO DATE, not within the period: acceptance is a
      // cohort question, so a July lead who paid in August counts on July.
      label: 'Collected',
      value: money0(collectedPence),
      sub: total.spendPence > 0
        ? `${multiple(collectedPence / total.spendPence)} of spend, to date`
        : 'To date, from this period’s leads',
      accent: true,
    },
  ];

  // Rows are the UNION of both periods, not just this one. The service builds
  // a practice row only where there was spend or a lead, so a practice that
  // spent last period and nothing this one is simply absent — and dropping it
  // would hide the single most interesting thing a comparison can show.
  const practiceRows: GoogleLeadPractice[] = compare
    ? [
      ...practices,
      ...[...cmpByPractice.values()]
        .filter((r) => !practices.some((p) => practiceKey(p.practiceId) === practiceKey(r.practiceId)))
        .map((r) => ({
          practiceId: r.practiceId, practiceName: r.practiceName,
          spendPence: 0, impressions: 0, clicks: 0,
          leads: 0, booked: 0, accepted: 0,
          // Costs, not counts: a cost per nothing is unknowable, not £0.00.
          cplPence: null, cpbPence: null, cpaPence: null,
        })),
    ]
    : practices;

  // One column builder, so a practice row's polarity and null-handling cannot
  // drift from the rail's — both go through computeDelta with the metric's own
  // polarity, and both drop the good/bad colour when that row is not
  // like-for-like.
  const practiceCol = (
    key: string, header: string,
    pick: (r: GoogleLeadPractice) => number | null,
    fmt: (v: number | null) => string,
    polarity: Polarity,
  ): GridColumn<GoogleLeadPractice> => ({
    key, header, align: 'right', sortBy: pick,
    render: (r) => {
      const k = practiceKey(r.practiceId);
      const previous = compare ? (cmpByPractice.get(k) ?? null) : null;
      const rowComparable = sourcesComparable(
        srcNow.get(k) ?? NO_SOURCES, srcThen.get(k) ?? NO_SOURCES,
      );
      return (
        <>
          {fmt(pick(r))}
          {compare && (
            <DeltaInline
              delta={computeDelta(
                pick(r),
                previous ? pick(previous) : null,
                rowComparable ? polarity : 'neutral',
              )}
            />
          )}
        </>
      );
    },
  });

  const practiceColumns: GridColumn<GoogleLeadPractice>[] = [
    {
      key: 'name', header: 'Practice', align: 'left',
      sortBy: (r) => r.practiceName ?? 'zzz',
      render: (r) => r.practiceName ?? 'Unmapped',
    },
    practiceCol('spend', 'Spend', (r) => r.spendPence, money0, 'neutral'),
    practiceCol('leads', 'Leads', (r) => r.leads, num, 'higher-better'),
    practiceCol('booked', 'Booked', (r) => r.booked, num, 'higher-better'),
    practiceCol('accepted', 'Patients', (r) => r.accepted, num, 'higher-better'),
    practiceCol('cpl', 'Cost / lead', (r) => r.cplPence, money, 'lower-better'),
    practiceCol('cpb', 'Cost / booking', (r) => r.cpbPence, money, 'lower-better'),
    practiceCol('cpa', 'Cost / patient', (r) => r.cpaPence, money, 'lower-better'),
  ];

  // The largest campaign spend in the table, for the share bar behind the name
  // column. Computed over ATTRIBUTED rows only: the unattributed bucket has no
  // spend, so including it changes nothing, but saying so here stops anyone
  // later "fixing" the bar to include a row that can never have a value.
  const maxCampaignSpend = campaigns.reduce((m, c) => Math.max(m, c.spendPence), 0);

  const campaignColumns: GridColumn<GoogleCampaignPerformance>[] = [
    {
      key: 'name', header: 'Campaign', align: 'left', width: 'min-w-[240px]',
      sortBy: (r) => r.campaignName ?? 'zzzz',
      render: (r) => (
        <span className={r.attributed ? 'font-medium text-ink' : 'italic'}>
          {r.campaignName ?? (r.attributed ? r.campaignId : 'Not attributed')}
        </span>
      ),
      // Channel type is load-bearing rather than decorative: it is what
      // explains a blank keyword column and a blank impression share on the
      // SAME row. A reader who can see "Performance max" understands the
      // blank; one who cannot assumes the data is broken.
      sub: (r) => (r.attributed
        ? (
          <span className="flex items-center gap-2">
            {r.channelType && <Chip>{humanise(r.channelType)}</Chip>}
            <ShareBar value={r.spendPence} max={maxCampaignSpend} />
          </span>
        )
        : 'Leads with no resolvable campaign'),
    },
    {
      key: 'spend', header: 'Spend', align: 'right', sortBy: (r) => r.spendPence,
      render: (r) => (r.attributed ? money0(r.spendPence) : DASH),
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
      // Money in, set against money out. The one column on this page that is
      // an outcome rather than a cost, so it carries the brand colour — and
      // the only one, because a page where several things are coloured is a
      // page where none of them mean anything.
      render: (r) => (
        <span className={r.paidPence > 0 ? 'font-medium text-brand-700' : ''}>
          {money0(r.paidPence)}
        </span>
      ),
      sub: (r) => (r.returnOnSpend === null ? null : `${multiple(r.returnOnSpend)} of spend`),
    },
  ];

  const coverage = data.attribution;
  const coveragePct = coverage.total > 0
    ? Math.round((coverage.attributed / coverage.total) * 100) : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex w-fit items-center gap-2 text-[12.5px] text-ink-muted">
          <input
            type="checkbox"
            checked={includeExisting}
            onChange={(e) => setIncludeExisting(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-border accent-brand"
          />
          Include existing patients
        </label>
        <ComparePicker
          since={selected.since}
          until={selected.until}
          value={compare}
          // Applying a comparison opens the per-practice breakdown: the group
          // total answers "did it move", but which practice moved is the
          // question anyone asks next, and it is already fetched.
          onChange={(next) => { setCompare(next); if (next) setShowPractices(true); }}
        />
      </div>

      <StatRail stats={stats} />

      {compare && !comparable && (
        <FootNote>
          <span className="font-medium text-ink">These two periods are not like for like.</span>{' '}
          {absentFromComparison.length > 0 && (
            <>
              {absentFromComparison.join(' and ')} leads are entirely absent from{' '}
              {compare.since} → {compare.until}
              {absentFromCurrent.length > 0 ? ', and ' : '. '}
            </>
          )}
          {absentFromCurrent.length > 0 && (
            <>{absentFromCurrent.join(' and ')} leads are absent from the selected period. </>
          )}
          That usually means attribution was not yet set up for the whole of the earlier window,
          not that performance changed — so the percentages are shown without a good/bad colour.
          The per-practice breakdown is judged practice by practice, so a practice whose own
          sources were tracked across both periods still gets its verdict.
        </FootNote>
      )}

      {compare && (
        <FootNote>
          Comparing {selected.since} → {selected.until} ({num(bySource.ghl + bySource.callrail)} leads)
          against {compare.since} → {compare.until} ({num(cmpBySource.ghl + cmpBySource.callrail)} leads).
          Arrows point the way each figure moved
          {comparable ? '; the colour says whether that is good news — for a cost, down is good.' : '.'}
        </FootNote>
      )}

      {openBucket && (
        <section className="flex flex-col gap-2">
          <SectionHead
            title={`${BUCKET_LABEL[openBucket]} in this period`}
            right={<span className="text-[12px] text-ink-muted">{num(rows.length)} people</span>}
          />
          <DataGrid
            columns={LEAD_COLUMNS}
            rows={rows}
            rowKey={(r, i) => `${r.phone ?? 'x'}-${i}`}
            emptyState={<EmptyState message="No leads in this bucket for the selected period." />}
          />
        </section>
      )}

      <section className="flex flex-col gap-2">
        <SectionHead
          title="By campaign"
          note="Each campaign's own spend against the patients it actually produced, and the money those patients have paid."
        />
        <DataGrid
          columns={campaignColumns}
          rows={campaigns}
          rowKey={(r) => r.campaignId ?? UNMAPPED}
          rowTone={(r) => (r.attributed ? 'default' : 'muted')}
          emptyState={<EmptyState message="No Google campaign activity in this window." />}
        />
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
      </section>

      {practiceRows.length > 1 && (
        <section className="flex flex-col gap-2">
          <SectionHead
            title="By practice"
            right={(
              <button
                type="button"
                onClick={() => setShowPractices((v) => !v)}
                className="text-[12.5px] text-brand hover:underline"
              >
                {showPractices ? 'Hide' : 'Show'}
              </button>
            )}
          />
          {showPractices && (
            <DataGrid
              columns={practiceColumns}
              rows={practiceRows}
              rowKey={(r) => practiceKey(r.practiceId)}
              emptyState={<EmptyState message="No practice-level data in this window." />}
            />
          )}
        </section>
      )}
    </div>
  );
}

// The drill-down list behind a rail cell. Now carries WHICH campaign and
// WHICH search bought each person — the single most useful thing on the page
// for anyone deciding where next month's budget goes, and the thing this list
// could not show at all before migration 000165.
const LEAD_COLUMNS: GridColumn<GoogleLeadRow>[] = [
  {
    key: 'name', header: 'Name', align: 'left',
    sortBy: (r) => r.name ?? 'zzz',
    render: (r) => r.name ?? DASH,
    sub: (r) => r.phone ?? r.email ?? null,
  },
  {
    key: 'campaign', header: 'Campaign', align: 'left', width: 'min-w-[200px]',
    sortBy: (r) => r.campaignName,
    render: (r) => (r.campaignName ?? <span className="italic text-ink-muted">Not attributed</span>),
    // The keyword is the sharpest fact on this row: it is the actual search
    // that produced the patient. Shown in quotes, with the ad group behind it
    // when there is no keyword (Performance Max never has one).
    sub: (r) => (r.keywordText
      ? <span>&ldquo;{r.keywordText}&rdquo;</span>
      : (r.adGroupName ?? (r.attribution ? ROUTE_LABEL[r.attribution] : null))),
  },
  {
    key: 'treatment', header: 'Treatment (Dentally)', align: 'left',
    sortBy: (r) => r.treatment ?? 'zzz',
    render: (r) => r.treatment ?? DASH,
  },
  {
    key: 'source', header: 'Source', align: 'left',
    sortBy: (r) => r.source,
    render: (r) => (r.source === 'callrail' ? 'Call' : 'Web form'),
    sub: (r) => r.practiceName ?? 'Unmapped',
  },
  {
    key: 'leadAt', header: 'Date', align: 'right',
    sortBy: (r) => r.leadAt,
    render: (r) => formatDate(r.leadAt),
    // Only meaningful once a Dentally patient is actually on record — booked
    // or accepted implies a match. isNewPatient defaults false for an
    // unmatched lead too, which is not the same claim as "existing".
    sub: (r) => ((r.booked || r.accepted) ? (r.isNewPatient ? 'New patient' : 'Existing') : null),
  },
  {
    key: 'booked', header: 'Booked', align: 'right',
    sortBy: (r) => (r.booked ? 1 : 0),
    render: (r) => (r.booked ? <Chip tone="good">Yes</Chip> : DASH),
  },
  {
    // The money behind the Accepted flag, shown beside it. A bare "Yes" hides
    // the threshold it was judged against, so £43 and £4,300 read identically
    // — and the whole point of the floor is that those two are different
    // answers. £0.00 is a real figure here (this lead has paid nothing), not
    // an unknown, so it is NOT dashed out.
    //
    // "since" because this is money TO DATE from the lead's own day, not money
    // inside the selected period: acceptance is a cohort question, so a July
    // lead who paid in August shows that payment on the July report.
    key: 'paid', header: 'Paid since', align: 'right',
    sortBy: (r) => r.paidPence,
    render: (r) => (
      <span className={r.accepted ? 'font-medium text-brand-700' : ''}>{money(r.paidPence)}</span>
    ),
  },
];
