'use client';
// Google report — blended CPL/CPB/CPA cards (migration 000158). Sits ABOVE
// the tab strip in GoogleReportScreen so it is visible regardless of which
// grain tab is active — it is not itself a tab, it is the answer to "what
// did Google spend cost us" that the four grain tabs deliberately do not
// carry (Google has no CRM lead funnel of its own, and CallRail calls carry
// no ad/campaign linkage — see google-report.service.js's leadPerformance
// header for the full reasoning).
//
// PRACTICE grain, not per-campaign: the cards show the all-practices total
// by default (the shared scope bar's own "All practices" default — nothing
// extra needed here for that), and clicking one reveals the SAME figure's
// per-practice breakdown plus a click-through list of the individual
// deduplicated leads behind it (name, email, treatment) — same
// click-to-expand idiom as the Business Hub's Treatments Accepted card
// (features/overview/components/GroupPerformanceScreen.tsx), not a modal.
import { useMemo, useState } from 'react';
import { EmptyState, SkeletonTable } from '@/components/ui';
import { formatDate } from '@/lib/format';
import { AdMetricTable, type Column } from '../../_shared/AdMetricTable';
import { money, num, DASH } from '../../_shared/format';
import {
  computeDelta, sourcesComparable, missingSources,
  type Polarity, type SourceCounts,
} from '../../_shared/compare';
import { DeltaBadge, DeltaInline } from '../../_shared/DeltaBadge';
import { ComparePicker, type CompareWindow } from '../../_shared/ComparePicker';
import {
  useGoogleLeadPerformance, useGoogleLeadPerformanceFor, useSelectedYmdWindow,
} from '../hooks';
import type { GoogleLeadPractice, GoogleLeadRow } from '../api';

type Bucket = 'leads' | 'booked' | 'accepted';

const BUCKET_LABEL: Record<Bucket, string> = {
  leads: 'Leads',
  booked: 'Booked',
  accepted: 'Accepted patients',
};

function Card({
  label, value, sub, active, onClick, delta,
}: {
  label: string; value: string; sub?: string; active: boolean; onClick?: () => void;
  /** The comparison chip, when a comparison period is switched on. Sits
   *  directly under the headline figure it describes, above the existing
   *  sub-line, so the percentage is unambiguously about the big number and
   *  not about the count beneath it. */
  delta?: React.ReactNode;
}) {
  const body = (
    <>
      <p className="text-[12.5px] font-medium text-ink-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-ink">{value}</p>
      {delta}
      {sub && <p className="mt-1 text-[12px] text-ink-muted">{sub}</p>}
    </>
  );
  if (!onClick) {
    return <div className="card-padded flex-1 min-w-[150px]">{body}</div>;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={active}
      className={`card-padded flex-1 min-w-[150px] text-left transition hover:border-brand ${
        active ? 'ring-2 ring-brand' : ''
      }`}
    >
      {body}
      <p className="mt-2 text-[11.5px] text-brand">{active ? 'Hide leads' : 'Click to see leads'}</p>
    </button>
  );
}

const LEAD_COLUMNS: Column<GoogleLeadRow>[] = [
  { key: 'name', header: 'Name', align: 'left', render: (r) => r.name ?? DASH },
  { key: 'phone', header: 'Phone', align: 'left', render: (r) => r.phone ?? DASH },
  { key: 'email', header: 'Email', align: 'left', render: (r) => r.email ?? DASH },
  {
    key: 'treatment',
    header: 'Treatment (Dentally)',
    align: 'left',
    render: (r) => r.treatment ?? DASH,
  },
  {
    key: 'source',
    header: 'Source',
    align: 'left',
    render: (r) => (r.source === 'callrail' ? 'CallRail' : 'GoHighLevel'),
  },
  { key: 'practice', header: 'Practice', align: 'left', render: (r) => r.practiceName ?? 'Unmapped' },
  { key: 'leadAt', header: 'Date', align: 'right', render: (r) => formatDate(r.leadAt) },
  {
    key: 'patientStatus',
    header: 'Patient',
    align: 'right',
    // Only meaningful once a Dentally patient is actually on record (booked
    // or accepted implies a match) — isNewPatient defaults false for an
    // unmatched lead too, which is not the same claim as "existing".
    render: (r) => ((r.booked || r.accepted) ? (r.isNewPatient ? 'New' : 'Existing') : DASH),
  },
  { key: 'booked', header: 'Booked', align: 'right', render: (r) => (r.booked ? 'Yes' : DASH) },
  // The money behind the Accepted flag, shown beside it. A bare "Yes" hides
  // the threshold it was judged against, so £43 and £4,300 read identically
  // — and the whole point of the £40 floor is that those two are different
  // answers. £0.00 here is a real figure (this lead has paid nothing), not
  // an unknown, so it is NOT dashed out.
  // "Paid" is money TO DATE since the lead landed, not money inside the
  // selected period — acceptance is a cohort question, so a July lead who
  // paid in August shows that payment on the July report. Headed "Paid
  // since" so the column cannot be read as period cash.
  { key: 'paid', header: 'Paid since', align: 'right', render: (r) => money(r.paidPence) },
  { key: 'accepted', header: 'Accepted', align: 'right', render: (r) => (r.accepted ? 'Yes' : DASH) },
];


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

export function GoogleLeadPerformanceCards() {
  // Owner-requested: "add an option like a toggle with existing patients" —
  // off (default) is the owner's own CPB/CPA definition (new patients only);
  // on counts every match regardless, to see the exclusion's effect
  // directly. Pure client-side state now: the payload already carries BOTH
  // totals (total/practices for new-only, totalAll/practicesAll for
  // including-existing) from ONE fetch, so flipping this costs no network
  // request — see useGoogleLeadPerformance's own comment for why that
  // mattered (it used to re-fetch the whole ~1s query on every toggle for a
  // decision the SQL never depended on).
  const [includeExisting, setIncludeExisting] = useState(false);
  const { data, isLoading, isError } = useGoogleLeadPerformance();
  const [openBucket, setOpenBucket] = useState<Bucket | null>(null);
  const [showPractices, setShowPractices] = useState(false);

  // Comparison period. null = off, and while it is null useGoogleLeadPerformanceFor
  // is disabled, so a page nobody asked to compare fires no extra request.
  const selected = useSelectedYmdWindow();
  const [compare, setCompare] = useState<CompareWindow | null>(null);
  const { data: cmp, isFetching: cmpFetching } = useGoogleLeadPerformanceFor(compare);

  const rows = useMemo(() => {
    if (!data || !openBucket) return [];
    if (openBucket === 'leads') return data.leads;
    // booked/accepted here must mirror how the ON-SCREEN total was counted:
    // every match in "including existing" mode, only is_new_patient ones
    // otherwise — see practiceLeadPerformance's `eligible` gate
    // (google-report.service.js), which built total/totalAll the same way.
    const eligible = (l: typeof data.leads[number]) => includeExisting || l.isNewPatient;
    if (openBucket === 'booked') return data.leads.filter((l) => l.booked && eligible(l));
    return data.leads.filter((l) => l.accepted && eligible(l));
  }, [data, openBucket, includeExisting]);

  // Leads split by where each one came from.
  //
  // Counted here rather than fetched: data.leads is the COMPLETE deduplicated
  // set (the repository pages the ledger RPC and stops on an empty page, so it
  // is the population and not a first page of 1000), and the leads figure is
  // the one number the existing-patients toggle does NOT gate — the `eligible`
  // check in practiceLeadPerformance applies to booked and accepted only. So
  // these two always sum to the headline exactly, in either toggle state.
  //
  // 'not callrail' is GoHighLevel, matching the Source column's own rule
  // rather than testing for 'ghl' — a row with an unexpected source must land
  // in the same bucket in the count and in the list it drills into, or the
  // split visibly fails to add up against a list that says otherwise.
  //
  // WHAT THIS IS NOT: a count of what each platform generated. Leads are
  // deduplicated by phone, keeping the EARLIEST touch, so someone who called
  // and also filled in a form appears once under whichever came first. These
  // are first-touch counts, which is why the label says so.
  const bySource = useMemo(() => splitBySource(data?.leads), [data]);

  // The SAME split, for the comparison period. Same helper, deliberately: two
  // copies of "which of these is CallRail" is how a coverage check ends up
  // measuring something subtly different from the figure it is guarding.
  const cmpBySource = useMemo(() => splitBySource(cmp?.leads), [cmp]);

  // The comparison's totals, read with the SAME existing-patients toggle as
  // the on-screen figure. Reading `total` here while the card shows
  // `totalAll` would compare new-patients-only against everyone and present
  // the difference as a change over time.
  //
  // Only used once the comparison payload has actually arrived AND says it
  // has data: a period in state 'not_connected'/'no_spend_in_window' carries
  // null totals, and computeDelta turns that into "no comparison" rather
  // than into a 100% collapse.
  const cmpTotal = compare && cmp?.state === 'ok'
    ? (includeExisting ? cmp.totalAll : cmp.total)
    : null;

  // Whether the two periods were measured the same way — see
  // ../../_shared/compare.ts's own header for the live case that forced this
  // (a 95% "improvement" in cost per patient that was entirely an
  // attribution-coverage cliff). When they were not, the arrows stay and the
  // good/bad colouring goes.
  const comparable = !cmpTotal || sourcesComparable(bySource, cmpBySource);
  const absentFromComparison = cmpTotal ? missingSources(bySource, cmpBySource) : [];
  const absentFromCurrent = cmpTotal ? missingSources(cmpBySource, bySource) : [];

  // PER-PRACTICE comparison. The comparison payload already carries its own
  // per-practice rows, so this needs no extra request — it is the same fetch
  // the cards above are reading, joined to this period's rows by practice.
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
  if (isLoading && !data) return <SkeletonTable rows={2} cols={4} />;
  if (!data) return null;

  // Nothing to show cards for at all (not_connected/never_synced/
  // no_spend_in_window) — the four grain tabs below already explain why via
  // their own state notices; this section simply stays quiet rather than
  // repeating the same explanation a second time above the tabs.
  if (data.state !== 'ok' || !data.total || !data.totalAll) return null;

  const total = includeExisting ? data.totalAll : data.total;
  const practices = includeExisting ? data.practicesAll : data.practices;

  // A leads figure of 0 here is ambiguous between "quiet period" and
  // "nobody has mapped a GoHighLevel pipeline to Google yet" — this org's
  // own ad_channel_pipelines map says which. Spend is still real and shown;
  // only the lead-derived figures are unknown, not wrong.
  if (!data.googlePipelinesMapped) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-3">
          <Card label="Google spend" value={money(total.spendPence)} sub="All practices, this period" active={false} />
        </div>
        <p className="rounded-panel border border-border bg-bg px-3 py-2 text-[12.5px] leading-relaxed text-ink-muted">
          Cost per lead, per booking and per accepted patient are not shown yet — no GoHighLevel pipeline
          has been mapped to Google Ads for this organisation, so leads cannot be attributed. {' '}
          <a href="/settings/ad-attribution" className="text-brand hover:underline">
            Set up ad attribution
          </a>{' '}
          to sort pipelines into Google and Facebook.
        </p>
      </div>
    );
  }

  const toggle = (b: Bucket) => setOpenBucket((cur) => (cur === b ? null : b));

  // One badge builder for all four cards, so the polarity of a metric is
  // declared once at the call site and the null/zero handling cannot differ
  // between them. `pick` reads the SAME field from both periods — passing two
  // different accessors is how a card ends up comparing CPL against CPB.
  const badge = (pick: (t: GoogleLeadPractice) => number | null, polarity: Polarity) => {
    if (!compare) return undefined;
    // The comparison is still in flight. Deliberately not rendering the
    // "no comparison" chip here — that states a fact about the data, and
    // "we have not asked yet" is not that fact.
    if (cmpFetching && !cmpTotal) {
      return <p className="mt-1 text-[11.5px] text-ink-muted">comparing…</p>;
    }
    const previous = cmpTotal ? pick(cmpTotal) : null;
    // Polarity is what turns a direction into good or bad news. Withholding
    // it when the periods are not like-for-like leaves the arrow and the
    // percentage — both facts — without the verdict, which is the part that
    // would be wrong.
    const delta = computeDelta(pick(total), previous, comparable ? polarity : 'neutral');
    return <DeltaBadge delta={delta} previousLabel={money(previous)} />;
  };

  // Rows are the UNION of both periods, not just this one. The service builds
  // a practice row only where there was spend or a lead, so a practice that
  // spent last period and nothing this one is simply absent — and dropping it
  // would hide the single most interesting thing a comparison can show. Those
  // appear with real zeroes, which is what they are.
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
  // drift from the cards' — both go through computeDelta with the metric's own
  // polarity, and both drop the good/bad colour when that row is not
  // like-for-like.
  const practiceCol = (
    key: string, header: string,
    pick: (r: GoogleLeadPractice) => number | null,
    fmt: (v: number | null) => string,
    polarity: Polarity,
  ): Column<GoogleLeadPractice> => ({
    key, header, align: 'right',
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

  const practiceColumns: Column<GoogleLeadPractice>[] = [
    { key: 'name', header: 'Practice', align: 'left', render: (r) => r.practiceName ?? 'Unmapped' },
    practiceCol('spend', 'Spend', (r) => r.spendPence, money, 'neutral'),
    practiceCol('leads', 'Leads', (r) => r.leads, num, 'higher-better'),
    practiceCol('booked', 'Booked', (r) => r.booked, num, 'higher-better'),
    practiceCol('accepted', 'Accepted', (r) => r.accepted, num, 'higher-better'),
    practiceCol('cpl', 'CPL', (r) => r.cplPence, money, 'lower-better'),
    practiceCol('cpb', 'CPB', (r) => r.cpbPence, money, 'lower-better'),
    practiceCol('cpa', 'CPA', (r) => r.cpaPence, money, 'lower-better'),
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
      <label className="flex w-fit items-center gap-2 text-[12.5px] text-ink-muted">
        <input
          type="checkbox"
          checked={includeExisting}
          onChange={(e) => setIncludeExisting(e.target.checked)}
          className="h-3.5 w-3.5 rounded border-border accent-brand"
        />
        Include existing patients (default: new patients only)
      </label>
        <ComparePicker
          since={selected.since}
          until={selected.until}
          value={compare}
          // Applying a comparison opens the per-practice breakdown: the
          // group total answers "did it move", but which practice moved is
          // the question anyone asks next, and it is already fetched.
          onChange={(next) => { setCompare(next); if (next) setShowPractices(true); }}
        />
      </div>

      <div className="flex flex-wrap gap-3">
        {/* Spend is NEUTRAL, not green-when-up: it is an input the practice
            controls, so a rise is neither good nor bad on its own. The three
            COST cards below are 'lower-better', which is why a rising cost
            per patient shows a RED up-arrow — see ../../_shared/compare.ts. */}
        <Card
          label="Google spend"
          value={money(total.spendPence)}
          sub="All practices, this period"
          active={false}
          delta={badge((t) => t.spendPence, 'neutral')}
        />
        <Card
          label="Cost per lead"
          value={money(total.cplPence)}
          sub={`${num(total.leads)} leads · ${num(bySource.ghl)} GoHighLevel · ${num(bySource.callrail)} CallRail`}
          active={openBucket === 'leads'}
          onClick={() => toggle('leads')}
          delta={badge((t) => t.cplPence, 'lower-better')}
        />
        <Card
          label="Cost per booking"
          value={money(total.cpbPence)}
          sub={`${num(total.booked)} booked in Dentally${includeExisting ? '' : ' (new patients)'}`}
          active={openBucket === 'booked'}
          onClick={() => toggle('booked')}
          delta={badge((t) => t.cpbPence, 'lower-better')}
        />
        <Card
          label="Cost per accepted patient"
          value={money(total.cpaPence)}
          // The threshold comes from the payload, never a literal here: the
          // server decided it, and a second copy in the UI is a copy that
          // can disagree with the number it is labelling.
          sub={`${num(total.accepted)} paid over ${money(data.acceptanceMinPaidPence)} to date${includeExisting ? '' : ' (new patients)'}`}
          active={openBucket === 'accepted'}
          onClick={() => toggle('accepted')}
          delta={badge((t) => t.cpaPence, 'lower-better')}
        />
      </div>

      {compare && !comparable && (
        <p className="rounded-panel border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-ink">
          <span className="font-medium">These two periods are not like for like.</span>{' '}
          {absentFromComparison.length > 0 && (
            <>
              {absentFromComparison.join(' and ')} leads are entirely absent
              from {compare.since} → {compare.until}
              {absentFromCurrent.length > 0 ? ', and ' : '. '}
            </>
          )}
          {absentFromCurrent.length > 0 && (
            <>{absentFromCurrent.join(' and ')} leads are absent from the selected period. </>
          )}
          That usually means attribution was not yet set up for the whole of the
          earlier window, not that performance changed — so the percentages below
          are shown without a good/bad colour. The per-practice breakdown is judged
          practice by practice, so a practice whose own sources WERE tracked across
          both periods still gets its verdict. Widen or move the comparison to a
          period where the same sources were being tracked.
        </p>
      )}

      {compare && (
        <p className="text-[11.5px] text-ink-muted">
          Comparing {selected.since} → {selected.until} ({num(bySource.ghl + bySource.callrail)} leads)
          against {compare.since} → {compare.until} ({num(cmpBySource.ghl + cmpBySource.callrail)} leads).
          Arrows point the way each figure moved
          {comparable ? '; the colour says whether that is good news — for a cost, down is good.' : '.'}
        </p>
      )}

      {practiceRows.length > 1 && (
        <button
          type="button"
          onClick={() => setShowPractices((v) => !v)}
          className="w-fit text-[12.5px] text-brand hover:underline"
        >
          {showPractices ? 'Hide per-practice breakdown' : 'Show per-practice breakdown'}
        </button>
      )}
      {showPractices && (
        <AdMetricTable
          columns={practiceColumns}
          rows={practiceRows}
          emptyState={<EmptyState message="No practice-level data in this window." />}
        />
      )}

      {openBucket && (
        <div className="flex flex-col gap-2">
          <p className="text-[12.5px] font-medium text-ink">
            {BUCKET_LABEL[openBucket]} in this period ({num(rows.length)})
          </p>
          <AdMetricTable
            columns={LEAD_COLUMNS}
            rows={rows}
            emptyState={<EmptyState message="No leads in this bucket for the selected period." />}
          />
        </div>
      )}
    </div>
  );
}
