'use client';
// Command Centre — real-data wired. No fabricated weights or synthetic
// dataset. Sources:
//   • KPIs + cash position  ← GET /api/analytics/dashboard-summary (baseline)
//   • 12-month chart        ← GET /api/analytics/revenue-series (baseline
//                              projection — derived, NOT live history)
//   • Per-practice scorecard← GET /api/analytics/practice-summary (real
//                              practices + settled payments; margin is the
//                              group baseline margin, flagged group-derived)
//   • Lead funnel           ← GET /api/leads/funnel (server-aggregated;
//                              NEVER sliced from the capped /api/leads list)
//   • Setup banner          ← GET /api/health (real setup_completed)
// The editable P&L (break-even/target) stays a CLIENT what-if tool, seeded
// from the real baseline. The range selector windows the chart only — KPIs
// are the real annual baseline figures, never range-scaled fabrications.
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useHealth } from '@/features/health/hooks';
import { useLeadFunnel } from '@/features/leads/hooks';
import { useMarketingRoi } from '@/features/growth/hooks';
import { formatPence as fmtPence } from '@/lib/format';
import { usePractices } from '@/features/practices/hooks';
import { useBusinessHub } from '@/features/overview/business-hub-api';
import {
  useDashboardSummary,
  useRevenueSeries,
} from '../hooks';
import {
  DEFAULT_PL_TEMPLATE,
  calcPL,
  rangeLabel,
  ccPounds,
  ccPoundsFull,
  type DateRange,
  type PLModel,
} from '../mock';
import { Skeleton } from '@/components/ui';

const POS = 'var(--success)';
const NEG = 'var(--danger)';
const AMB = 'var(--warning)';
const BRAND = 'var(--brand)';

const RANGES: { k: DateRange; l: string }[] = [
  { k: 'mtd', l: 'MTD' },
  { k: 'qtd', l: 'QTD' },
  { k: '6m', l: '6M' },
  { k: 'ytd', l: 'YTD' },
];

// MTD/QTD/6M/YTD → concrete [from,to] (YYYY-MM-DD) so the period drives the
// whole dashboard (KPIs + chart), not just a client-side chart slice.
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function rangeToDates(range: DateRange): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const to = ymd(now);
  let from: Date;
  if (range === 'mtd') from = new Date(y, m, 1);
  else if (range === 'qtd') from = new Date(y, Math.floor(m / 3) * 3, 1);
  else if (range === '6m') from = new Date(y, m - 5, 1);
  else from = new Date(y, 0, 1); // ytd
  return { from: ymd(from), to };
}

// Seed the editable P&L model from the org's real Business Health baseline
// where set; otherwise the template. The P&L stays a client what-if tool —
// only its starting numbers are real. baseline money is whole pounds; cost_*
// are percentages of revenue, the same unit as PLLine.pct.
function seededPL(
  baseline: Record<string, any> | undefined,
  targetMargin: number,
): PLModel {
  const b = baseline || {};
  const num = (v: unknown) => (typeof v === 'number' && v > 0 ? v : undefined);
  const COGS_MAP: Record<string, string> = {
    principal: 'cost_associates',
    lab: 'cost_lab',
    materials: 'cost_materials',
  };
  const OPEX_MAP: Record<string, string> = {
    marketing: 'cost_marketing',
    salaries: 'cost_staff',
    rent: 'cost_property',
  };
  const seed = (
    l: { id: string; label: string; pct: number; type: string; fixed?: boolean },
    map: Record<string, string>,
  ) => {
    const v = num(b[map[l.id]]);
    return v === undefined ? l : { ...l, pct: v };
  };
  return {
    ...DEFAULT_PL_TEMPLATE,
    turnover: num(b.revenue) ?? DEFAULT_PL_TEMPLATE.turnover,
    cogs: DEFAULT_PL_TEMPLATE.cogs.map((l) => seed(l, COGS_MAP)),
    opex: DEFAULT_PL_TEMPLATE.opex.map((l) => seed(l, OPEX_MAP)),
    targetMargin,
  };
}

export default function DashboardScreen() {
  const { data: health } = useHealth();
  const healthComplete = !!health?.setup_completed;

  const [range, setRange] = useState<DateRange>('ytd');
  // A custom [from,to] window overrides the preset chips and drives the whole
  // dashboard (KPIs + chart). null = follow the active MTD/QTD/6M/YTD chip.
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null);
  const [selected, setSelected] = useState<string>('All practices');
  const period = useMemo(
    () => custom ?? rangeToDates(range),
    [range, custom],
  );
  const periodLabel = custom ? 'Custom' : rangeLabel(range);

  // Practice selector drives the WHOLE dashboard. Resolve the chosen name → id
  // (null = All) and feed it to the period-scoped summary + chart.
  const { data: practicesData } = usePractices();
  // Dentally-mapped sites only — GoHighLevel auto-creates pms_site_id-null
  // pseudo-practices for CRM scoping; they must not appear in the dashboard
  // practice selector (kept on Business Hub + Elevate CRM only).
  const allPractices: { id: string; name: string }[] = (practicesData?.practices ?? []).filter(
    (p) => p.pms_site_id != null,
  );
  const selectedId = selected === 'All practices'
    ? null
    : allPractices.find((p) => p.name === selected)?.id ?? null;

  const { data: summary, isLoading: sumLoading } = useDashboardSummary(period, selectedId);
  const { data: seriesResp, isLoading: seriesLoading } = useRevenueSeries(period, selectedId);
  // Per-practice scorecard is sourced from the Business Hub rollup (single source
  // of truth) windowed to the dashboard period — billed turnover per practice,
  // same logic the Business Hub page renders. UTC day bounds match ScopePeriod.
  const hubWin = useMemo(() => ({
    since: new Date(`${period.from}T00:00:00Z`).toISOString(),
    until: new Date(new Date(`${period.to}T00:00:00Z`).getTime() + 86_400_000).toISOString(),
    label: periodLabel,
  }), [period, periodLabel]);
  const { data: hub, isLoading: hubLoading } = useBusinessHub(hubWin);
  // Funnel is aggregated server-side over the SAME window and practice as the
  // rest of the page. It used to be computed in the browser from useLeads(),
  // which returns at most 100 rows ordered newest-first: on a real org that
  // reported "100 leads · 0.0% conv" against 1,388 leads and 3.5%, because the
  // 100 newest leads are days old and none of them have converted yet.
  // Practice scope is passed as an id, never matched on practice NAME.
  const { data: funnelData, isLoading: leadsLoading } = useLeadFunnel({
    since: period.from,
    until: period.to,
    practiceId: selectedId,
  });
  const { data: roi } = useMarketingRoi();

  const noBaseline = !!summary?.error;

  const [targetMargin, setTargetMargin] = useState<number>(
    DEFAULT_PL_TEMPLATE.targetMargin,
  );

  const practiceNames = useMemo(() => allPractices.map((p) => p.name), [allPractices]);
  const practiceList = ['All practices', ...practiceNames];

  const v = useMemo(() => {
    const TM = targetMargin / 100;
    // Is there a real cost model behind the break-even panel at all? The
    // template is a demo P&L (a £2,000,000 turnover and invented cost
    // percentages). When the baseline is empty — as it is for any org that has
    // not completed Business Health setup — seededPL returns that template
    // unchanged, and the panel rendered "Break-even £871k/yr · covered 455%"
    // as though it were this business's numbers. It was not: it was the
    // template's. Render the panel only when the model is seeded from real
    // baseline figures.
    const baseline = health?.baseline ?? {};
    // Break-even is a function of the FIXED/VARIABLE COST SPLIT, not of
    // turnover. A baseline carrying revenue but no cost_* fields still leaves
    // seededPL using the template's invented percentages, so scaling them to a
    // real turnover yields a real-looking break-even built on fictional costs —
    // the same defect, harder to spot. Require turnover AND at least one real
    // cost input before the panel claims to describe this business.
    const COST_KEYS = [
      'cost_associates', 'cost_lab', 'cost_materials',
      'cost_staff', 'cost_property', 'cost_marketing',
    ] as const;
    const hasCostModel =
      typeof baseline.revenue === 'number' &&
      baseline.revenue > 0 &&
      COST_KEYS.some((k) => typeof baseline[k] === 'number' && baseline[k] > 0);
    const pl = seededPL(baseline, targetMargin);
    const calc = calcPL(pl);

    // Real annual figures (whole pounds) from the baseline summary.
    const rev = summary?.revenue ?? 0;
    const profit = summary?.netProfit ?? 0;
    const cash = summary?.cashCollected ?? 0;
    const opEx = summary?.totalCosts ?? 0;
    // Nullable on purpose — `?? 0` here is what turned "we have no cost feed"
    // into a confident £0 on three cash lines.
    const cashflow = summary?.cashflow ?? null;
    const reserve = summary?.reserve ?? null;
    const excess = summary?.excessCash ?? null;
    const bankBalance = summary?.bankBalance ?? null;
    const monthsCovered = summary?.monthsCovered ?? 12;
    const margin = summary?.margin ?? 0;
    const targetProfit = rev * TM;
    const targetGap = targetProfit - profit;

    // Chart: real monthly revenue for the selected period (server-scoped).
    const win = seriesResp?.months ?? [];
    const chartSeries = win.map((m) => ({
      month: m.month,
      revenue: m.revenue,
      profit: m.profit,
      cash: m.cash,
      target: Math.round(m.revenue * TM),
      // Monthly break-even, only when it comes from a real cost model. Without
      // one it is the demo template's £871k/12, and it both drew a false
      // reference line and — via chartMax — rescaled the real bars against it.
      be: hasCostModel ? calc.breakeven / 12 : 0,
    }));
    const chartMax = Math.max(
      1,
      ...chartSeries.map((s) => Math.max(s.revenue, s.be)),
    );
    const rangeRev = win.reduce((s, m) => s + m.revenue, 0);
    const firstM = win[0]?.month ?? '';
    const lastM = win[win.length - 1]?.month ?? '';
    const dateLabel = win.length === 1 ? firstM : `${firstM} → ${lastM}`;

    // Break-even bar (group annualised, from the editable P&L).
    //
    // calc.breakeven is an ANNUAL figure. `rev` is the selected period's
    // revenue, which on MTD is a few weeks. Comparing them directly — as this
    // did, under a variable literally named `annualisedRev` that annualised
    // nothing — made a healthy business read as far below break-even on any
    // window shorter than a year. Scale the period up to a year so both sides
    // of the comparison cover the same span.
    const annualisedRev = monthsCovered > 0 ? (rev * 12) / monthsCovered : rev;
    const scaleMax =
      Math.max(calc.breakeven, calc.revAtTarget ?? 0, annualisedRev) * 1.05 ||
      1;
    const beBarW = (calc.breakeven / scaleMax) * 100;
    const targetBarW = calc.revAtTarget
      ? (calc.revAtTarget / scaleMax) * 100
      : 0;
    const actualBarW = (annualisedRev / scaleMax) * 100;
    const beCoverage =
      calc.breakeven > 0 ? (annualisedRev / calc.breakeven) * 100 : 100;

    const kpis = [
      {
        icon: '📈',
        label: 'Turnover',
        value: ccPounds(rev),
        // The basis genuinely varies (accounting actuals > invoiced production
        // > settled cash, in that precedence). Hardcoding "invoiced production"
        // mislabelled the number on two of the three paths — and on the
        // settled path it silently claimed accrual turnover while showing cash.
        sub: `${periodLabel} · ${
          summary?.turnoverBasis === 'actuals'
            ? 'accounting actuals'
            : summary?.turnoverBasis === 'billed'
              ? 'invoiced production'
              : 'settled payments'
        }`,
        colour: POS,
        link: '/profit',
      },
      {
        icon: '💷',
        label: 'Takings',
        value: ccPounds(cash),
        sub: `${periodLabel} · settled payments received`,
        colour: POS,
        link: '/cashflow',
      },
      {
        icon: '📊',
        label: 'Net profit',
        value: ccPounds(profit),
        sub: `${margin.toFixed(1)}% margin · ${
          margin >= targetMargin ? '✓ above target' : 'below target'
        }`,
        colour:
          margin >= targetMargin
            ? POS
            : margin >= targetMargin * 0.75
              ? AMB
              : NEG,
        link: '/profit',
      },
      {
        // Was the bank balance under a label describing cash − costs. Now it
        // IS cash − costs, and shows "—" when there is no cost feed to
        // subtract rather than a bank figure dressed as a calculation.
        icon: '💧',
        label: 'Operating cashflow',
        value: cashflow === null ? '—' : ccPounds(cashflow),
        sub:
          cashflow === null
            ? 'Connect accounting for costs'
            : `Cash in − costs · ${ccPounds(opEx)} costs`,
        colour: cashflow === null ? AMB : cashflow > 0 ? POS : NEG,
        link: '/cashflow',
      },
      {
        // Was a second copy of the bank balance. Now it is the bank position
        // net of the reserve, and says so.
        icon: '🏦',
        label: 'Excess cash',
        value: excess === null ? '—' : ccPounds(excess),
        sub:
          excess === null
            ? bankBalance === null
              ? 'Connect a bank account'
              : `${ccPounds(bankBalance)} at bank · reserve needs costs`
            : `${ccPounds(bankBalance ?? 0)} at bank − ${ccPounds(reserve ?? 0)} reserve`,
        colour: excess === null ? AMB : excess >= 0 ? POS : NEG,
        link: '/financial',
      },
      {
        icon: '🎯',
        label: `Target profit @${targetMargin.toFixed(1)}%`,
        value: ccPounds(targetProfit),
        sub:
          targetGap > 0
            ? `${ccPounds(targetGap)} gap to target`
            : `✓ ${ccPounds(-targetGap)} over target`,
        colour: targetGap > 0 ? AMB : POS,
        link: '/profit',
      },
    ];

    // Per-practice scorecard from the Business Hub rollup (source of truth):
    // billed turnover per practice (revenuePence), windowed to the dashboard
    // period. Dentally-mapped sites only — drop GoHighLevel pseudo-practices.
    // Margin is group-derived (no per-practice P&L feed), as on Business Hub.
    // Turnover is genuinely per practice. Margin is NOT — there is no
    // per-practice cost feed, so every tile used to print the identical group
    // margin and an identical "✓ Target hit" / "Below target" verdict. Five
    // tiles showing the same number look like five measurements; they are one
    // number copied five times, and the verdict is a group verdict wearing a
    // practice's name. Show each practice's share of group turnover instead —
    // that is a real per-practice figure — and state the group margin once, in
    // the panel header, where it belongs.
    const dentallyIds = new Set(allPractices.map((p) => p.id));
    const scorecardRows = (hub?.practices ?? []).filter((p) => dentallyIds.has(p.practiceId));
    const scorecardTotal = scorecardRows.reduce((t, p) => t + p.revenuePence, 0);
    const scorecard = scorecardRows.map((p) => ({
      name: p.name,
      turnover: Math.round(p.revenuePence / 100),
      sharePct: scorecardTotal ? (p.revenuePence / scorecardTotal) * 100 : 0,
    }));

    // Lead funnel — server-aggregated over the page's window + practice. The
    // stage maths (cumulative counts, lost leads kept at the stage they
    // reached) lives in leadService.funnel so every funnel surface agrees.
    const funnel = funnelData?.stages ?? [];
    const totalLeads = funnelData?.total ?? 0;
    const treatmentStarted = funnelData?.started ?? 0;
    const lostLeads = funnelData?.lost ?? 0;
    const convRate = funnelData?.conversionPct ?? null;
    const fmax = Math.max(...funnel.map((s) => s.count), 1);

    return {
      calc,
      hasCostModel,
      rev,
      cash,
      opEx,
      cashflow,
      reserve,
      excess,
      bankBalance,
      monthsCovered,
      margin,
      rangeRev,
      dateLabel,
      kpis,
      scorecard,
      chartSeries,
      chartMax,
      beBarW,
      targetBarW,
      actualBarW,
      beCoverage,
      annualisedRev,
      totalLeads,
      treatmentStarted,
      lostLeads,
      convRate,
      funnel,
      fmax,
      TM,
    };
  }, [
    summary,
    seriesResp,
    hub,
    practicesData,
    funnelData,
    health,
    selected,
    range,
    periodLabel,
    targetMargin,
  ]);

  return (
    <div className="mx-auto" style={{ maxWidth: 1500 }}>
      {!healthComplete && (
        <div
          className="text-white flex items-center gap-4 mb-4"
          style={{
            background: 'linear-gradient(135deg, var(--brand) 0%, #085857 100%)',
            padding: '16px 22px',
            borderRadius: 12,
          }}
        >
          <div style={{ fontSize: 22 }}>🎯</div>
          <div className="flex-1">
            <div className="display font-bold" style={{ fontSize: 15 }}>
              Set up Business Health baseline
            </div>
            <div style={{ fontSize: 11, opacity: 0.9 }}>
              Capture where you are today — every figure below reads from it
            </div>
          </div>
          <Link
            href="/health-setup"
            className="font-bold"
            style={{
              background: 'white',
              color: BRAND,
              padding: '8px 16px',
              borderRadius: 8,
              fontSize: 12,
            }}
          >
            Start →
          </Link>
        </div>
      )}

      <div className="mb-3">
        <div className="flex justify-between items-end gap-3 flex-wrap">
          <div>
            <h1 className="display font-bold" style={{ fontSize: 28 }}>
              Command Centre
            </h1>
            <p className="text-ink-muted" style={{ fontSize: 13 }}>
              Group · {practiceNames.length || 0} practices · {periodLabel}{' '}
              ({v.dateLabel || '—'})
            </p>
          </div>
          <div className="text-right">
            <div
              className="text-ink-muted font-bold uppercase"
              style={{ fontSize: 10, letterSpacing: '0.05em' }}
            >
              {periodLabel} takings (real)
            </div>
            <div
              className="display font-bold text-brand"
              style={{ fontSize: 28, lineHeight: 1 }}
            >
              {sumLoading ? '…' : noBaseline ? '—' : ccPounds(v.cash)}
            </div>
          </div>
        </div>
      </div>

      {noBaseline && (
        <div
          className="card card-padded mb-4"
          style={{ borderLeft: `4px solid ${AMB}` }}
        >
          <div className="font-bold" style={{ fontSize: 13 }}>
            No baseline set
          </div>
          <div className="text-ink-muted" style={{ fontSize: 12 }}>
            Financial KPIs, the projection chart and the cash position read
            from your Business Health baseline. Complete setup to populate them.
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div
        className="bg-bg flex gap-4 items-center flex-wrap mb-4"
        style={{ borderRadius: 10, padding: 10 }}
      >
        <div className="flex gap-1.5 items-center flex-wrap">
          <span
            className="text-ink-muted font-bold uppercase"
            style={{ fontSize: 10 }}
          >
            Practice:
          </span>
          {practiceList.map((p) => (
            <button
              key={p}
              onClick={() => setSelected(p)}
              className="font-bold"
              style={{
                padding: '6px 11px',
                borderRadius: 5,
                fontSize: 11,
                border: `1px solid ${selected === p ? BRAND : 'var(--border)'}`,
                background: selected === p ? BRAND : 'white',
                color: selected === p ? 'white' : '#1F2937',
              }}
            >
              {p === 'All practices' ? 'All' : p}
            </button>
          ))}
        </div>

        <div
          className="flex gap-1 items-center"
          style={{ borderLeft: '1px solid var(--border)', paddingLeft: 14 }}
        >
          <span
            className="text-ink-muted font-bold uppercase"
            style={{ fontSize: 10 }}
          >
            📅 Chart:
          </span>
          {RANGES.map((r) => {
            const active = range === r.k && !custom;
            return (
              <button
                key={r.k}
                onClick={() => {
                  setCustom(null);
                  setRange(r.k);
                }}
                className="font-bold"
                style={{
                  padding: '6px 11px',
                  borderRadius: 5,
                  fontSize: 11,
                  border: `1px solid ${active ? BRAND : 'var(--border)'}`,
                  background: active ? BRAND : 'white',
                  color: active ? 'white' : '#1F2937',
                }}
              >
                {r.l}
              </button>
            );
          })}
        </div>

        {/* Custom date range — overrides the preset chips. Editing either input
            switches to custom mode; the range drives KPIs + chart (server caps
            the chart at 36 months). */}
        <div
          className="flex gap-1.5 items-center"
          style={{ borderLeft: '1px solid var(--border)', paddingLeft: 14 }}
        >
          <span
            className="text-ink-muted font-bold uppercase"
            style={{ fontSize: 10 }}
          >
            From:
          </span>
          <input
            type="date"
            value={period.from}
            min="2020-01-01"
            max={period.to}
            onChange={(e) => {
              const from = e.target.value;
              if (!from) return;
              const to = period.to;
              setCustom(from > to ? { from: to, to: from } : { from, to });
            }}
            className="font-bold"
            style={{
              padding: '5px 8px',
              border: `1px solid ${custom ? BRAND : 'var(--border)'}`,
              borderRadius: 5,
              fontSize: 12,
            }}
          />
          <span
            className="text-ink-muted font-bold uppercase"
            style={{ fontSize: 10 }}
          >
            To:
          </span>
          <input
            type="date"
            value={period.to}
            min={period.from}
            max={ymd(new Date())}
            onChange={(e) => {
              const to = e.target.value;
              if (!to) return;
              const from = period.from;
              setCustom(to < from ? { from: to, to: from } : { from, to });
            }}
            className="font-bold"
            style={{
              padding: '5px 8px',
              border: `1px solid ${custom ? BRAND : 'var(--border)'}`,
              borderRadius: 5,
              fontSize: 12,
            }}
          />
        </div>

        <div
          className="flex gap-1.5 items-center"
          style={{ borderLeft: '1px solid var(--border)', paddingLeft: 14 }}
        >
          <span
            className="text-ink-muted font-bold uppercase"
            style={{ fontSize: 10 }}
          >
            🎯 Target margin:
          </span>
          <input
            type="number"
            value={targetMargin}
            min={0}
            max={100}
            step={0.5}
            onChange={(e) => {
              const n = parseFloat(e.target.value);
              if (!isNaN(n) && n >= 0 && n <= 100) setTargetMargin(n);
            }}
            className="font-bold text-right"
            style={{
              width: 60,
              padding: '5px 8px',
              border: '1px solid var(--border)',
              borderRadius: 5,
              fontSize: 12,
            }}
          />
          <span className="font-bold" style={{ fontSize: 12 }}>
            %
          </span>
          <Link
            href="/profit"
            className="font-bold"
            style={{
              padding: '6px 11px',
              borderRadius: 5,
              fontSize: 11,
              border: '1px solid var(--border)',
              background: 'white',
              color: '#1F2937',
            }}
          >
            Edit P&amp;L
          </Link>
        </div>
      </div>

      {/* 6 KPIs */}
      <div
        className="grid gap-3 mb-4"
        style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}
      >
        {v.kpis.map((k) => (
          <Link
            key={k.label}
            href={k.link}
            className="card card-padded block"
            style={{ borderLeft: `4px solid ${k.colour}` }}
          >
            <div className="flex gap-3 items-start">
              <div
                className="flex items-center justify-center flex-shrink-0"
                style={{
                  width: 42,
                  height: 42,
                  background: `${k.colour}15`,
                  borderRadius: 10,
                  fontSize: 20,
                }}
              >
                {k.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div
                  className="text-ink-muted font-bold uppercase"
                  style={{ fontSize: 10, letterSpacing: '0.05em' }}
                >
                  {k.label}
                </div>
                <div
                  className="display font-bold"
                  style={{
                    fontSize: 26,
                    color: k.colour,
                    lineHeight: 1.1,
                    margin: '4px 0 2px',
                  }}
                >
                  {sumLoading ? '…' : noBaseline ? '—' : k.value}
                </div>
                <div
                  className="text-ink-muted"
                  style={{ fontSize: 10, lineHeight: 1.4 }}
                >
                  {k.sub}
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {/* Paid marketing — live ad spend / ROAS / CPL (Google Ads now; Meta
          next). Hidden until ads are connected + synced. Links to Marketing. */}
      {roi?.connected && (
        <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          {[
            { label: 'Ad spend (30d)', value: fmtPence(roi.spend_pence), sub: `${roi.clicks.toLocaleString('en-GB')} clicks`, colour: BRAND },
            { label: 'ROAS', value: roi.roas ? `${roi.roas.toFixed(2)}x` : '—', sub: 'settled revenue / spend', colour: roi.roas >= 1 ? POS : NEG },
            { label: 'Cost / lead', value: roi.cpl_pence ? fmtPence(roi.cpl_pence) : '—', sub: `${roi.leads_from_ads.toLocaleString('en-GB')} ad leads`, colour: AMB },
          ].map((k) => (
            <Link key={k.label} href="/marketing" className="card card-padded block" style={{ borderLeft: `4px solid ${k.colour}` }}>
              <div className="text-ink-muted font-bold uppercase" style={{ fontSize: 10, letterSpacing: '0.05em' }}>{k.label}</div>
              <div className="display font-bold" style={{ fontSize: 26, color: k.colour, lineHeight: 1.1, margin: '4px 0 2px' }}>{k.value}</div>
              <div className="text-ink-muted" style={{ fontSize: 10, lineHeight: 1.4 }}>{k.sub}</div>
            </Link>
          ))}
        </div>
      )}

      {/* Break-even · Target · Actual.
          Rendered ONLY with a real cost model. Without a saved baseline,
          seededPL falls back to a demo template (a £2,000,000 turnover and
          invented cost percentages), and this panel presented those template
          figures — break-even, contribution margin, revenue-to-target — as
          precise facts about the practice group. An empty panel that says why
          is worth more than four confident numbers about a business that is
          not yours. */}
      {!v.hasCostModel ? (
        <div className="card card-padded mb-4" style={{ borderLeft: `4px solid ${AMB}` }}>
          <h2 className="display font-bold" style={{ fontSize: 16 }}>
            Break-even · Target · Actual
          </h2>
          <p className="text-ink-muted" style={{ fontSize: 12, marginTop: 6 }}>
            Break-even needs your cost structure — turnover plus the cost lines
            as a percentage of it. Add them in Business Health setup and this
            panel fills in. Until then it would only show a worked example, not
            your figures.
          </p>
          <Link
            href="/health-setup"
            className="font-bold inline-block"
            style={{
              marginTop: 10,
              padding: '7px 12px',
              borderRadius: 6,
              fontSize: 11,
              border: '1px solid var(--border)',
              background: 'white',
            }}
          >
            Set up cost baseline →
          </Link>
        </div>
      ) : (
      <div className="card card-padded mb-4">
        <div className="flex justify-between items-end mb-3 flex-wrap gap-2">
          <div>
            <h2 className="display font-bold" style={{ fontSize: 16 }}>
              Break-even · Target · Actual
            </h2>
            <p className="text-ink-muted" style={{ fontSize: 11 }}>
              Group annualised · derived from your editable P&amp;L (seeded from
              baseline)
            </p>
          </div>
          <Link
            href="/profit"
            className="font-bold"
            style={{
              padding: '7px 12px',
              borderRadius: 6,
              fontSize: 11,
              border: '1px solid var(--border)',
              background: 'white',
            }}
          >
            Edit P&amp;L target →
          </Link>
        </div>

        <div
          className="bg-bg"
          style={{
            position: 'relative',
            height: 56,
            borderRadius: 8,
            margin: '32px 0',
          }}
        >
          <div
            className="flex items-center text-white font-bold"
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              height: '100%',
              width: `${v.actualBarW}%`,
              background: `linear-gradient(90deg, ${BRAND}, ${BRAND}CC)`,
              paddingLeft: 12,
              fontSize: 12,
              borderRadius: '8px 0 0 8px',
            }}
          >
            ACTUAL {ccPounds(v.annualisedRev)}
          </div>
          <div
            style={{
              position: 'absolute',
              left: `${v.beBarW}%`,
              top: -10,
              bottom: -10,
              width: 3,
              background: NEG,
              zIndex: 2,
            }}
          />
          <div
            className="font-bold"
            style={{
              position: 'absolute',
              left: `${v.beBarW}%`,
              top: -28,
              transform: 'translateX(-50%)',
              fontSize: 10,
              color: NEG,
              whiteSpace: 'nowrap',
              background: 'white',
              padding: '2px 6px',
              borderRadius: 3,
              border: `1px solid ${NEG}`,
            }}
          >
            ⚠ BE {ccPounds(v.calc.breakeven)}
          </div>
          {v.calc.revAtTarget && (
            <>
              <div
                style={{
                  position: 'absolute',
                  left: `${v.targetBarW}%`,
                  top: -10,
                  bottom: -10,
                  width: 3,
                  background: AMB,
                  zIndex: 2,
                }}
              />
              <div
                className="font-bold"
                style={{
                  position: 'absolute',
                  left: `${v.targetBarW}%`,
                  bottom: -28,
                  transform: 'translateX(-50%)',
                  fontSize: 10,
                  color: AMB,
                  whiteSpace: 'nowrap',
                  background: 'white',
                  padding: '2px 6px',
                  borderRadius: 3,
                  border: `1px solid ${AMB}`,
                }}
              >
                🎯 @{targetMargin}% {ccPounds(v.calc.revAtTarget)}
              </div>
            </>
          )}
        </div>

        <div
          className="grid gap-2"
          style={{ gridTemplateColumns: 'repeat(4, 1fr)', fontSize: 11 }}
        >
          {[
            {
              label: 'Break-even revenue',
              big: `${ccPounds(v.calc.breakeven)}/yr`,
              bigColour: NEG,
              sub: `${ccPounds(v.calc.breakeven / 12)}/mo · covered ${v.beCoverage.toFixed(0)}%`,
            },
            {
              label: 'Contribution margin',
              big: `${v.calc.contributionMargin.toFixed(1)}%`,
              sub: `£1 sales → ${(v.calc.contributionMargin / 100).toFixed(2)} contribution`,
            },
            {
              label: `Revenue to hit ${targetMargin}%`,
              big: v.calc.revAtTarget
                ? `${ccPounds(v.calc.revAtTarget)}/yr`
                : 'N/A',
              bigColour: AMB,
              sub: v.calc.revAtTarget
                ? `${ccPounds(v.calc.revAtTarget / 12)}/mo`
                : 'increase margin or cut fixed',
            },
            {
              label: 'Margin actual vs target',
              big: `${v.margin.toFixed(1)}% / ${targetMargin}%`,
              bigColour: v.margin >= targetMargin ? POS : AMB,
              sub:
                v.margin >= targetMargin
                  ? '✓ above target'
                  : `gap ${(targetMargin - v.margin).toFixed(1)} pts`,
            },
          ].map((c) => (
            <div
              key={c.label}
              className="bg-bg"
              style={{ padding: 10, borderRadius: 6 }}
            >
              <div
                className="text-ink-muted uppercase font-bold"
                style={{ fontSize: 9 }}
              >
                {c.label}
              </div>
              <div
                className="display font-bold"
                style={{ fontSize: 15, color: c.bigColour }}
              >
                {c.big}
              </div>
              <div className="text-ink-muted" style={{ fontSize: 10 }}>
                {c.sub}
              </div>
            </div>
          ))}
        </div>
      </div>
      )}

      {/* Per-practice scorecard (real turnover; margin group-derived) */}
      <div className="card card-padded mb-4">
        <div className="flex justify-between items-center mb-2.5">
          <h2 className="display font-bold" style={{ fontSize: 16 }}>
            Per-practice scorecard
          </h2>
          <span className="text-ink-muted" style={{ fontSize: 11 }}>
            Billed turnover ({periodLabel}) · share of group ·{' '}
            {v.margin ? `group margin ${v.margin.toFixed(1)}%` : 'no per-practice margin feed'}
          </span>
        </div>
        {hubLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-5 w-full" />
            ))}
          </div>
        ) : v.scorecard.length === 0 ? (
          <div className="text-ink-muted" style={{ fontSize: 12 }}>
            No billed turnover for any practice in this period yet.
          </div>
        ) : (
          <div
            className="grid gap-2"
            style={{
              gridTemplateColumns: `repeat(${Math.min(v.scorecard.length, 6)}, 1fr)`,
            }}
          >
            {v.scorecard.map((p) => (
              <button
                key={p.name}
                onClick={() => setSelected(p.name)}
                className="text-left"
                style={{
                  padding: 12,
                  border: `1px solid ${selected === p.name ? BRAND : 'var(--border)'}`,
                  borderRadius: 8,
                  background: 'white',
                }}
              >
                <div
                  className="font-bold"
                  style={{
                    fontSize: 11,
                    lineHeight: 1.3,
                    marginBottom: 8,
                    minHeight: 30,
                  }}
                >
                  {p.name}
                </div>
                <div
                  className="display font-bold text-brand"
                  style={{ fontSize: 18 }}
                >
                  {ccPounds(p.turnover)}
                </div>
                <div
                  className="text-ink-muted"
                  style={{ fontSize: 10, marginTop: 2 }}
                >
                  {p.sharePct.toFixed(1)}% of group turnover
                </div>
                <div
                  className="bg-bg"
                  style={{
                    marginTop: 8,
                    height: 6,
                    borderRadius: 3,
                    overflow: 'hidden',
                  }}
                >
                  {/* Share of group turnover — a real per-practice quantity.
                      This bar previously encoded the group margin against the
                      target, so every practice drew an identical bar and an
                      identical verdict. */}
                  <div
                    style={{
                      height: '100%',
                      width: `${Math.min(100, p.sharePct)}%`,
                      background: BRAND,
                    }}
                  />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 12-month projection chart */}
      <div className="card card-padded mb-4">
        <div className="flex justify-between items-center mb-3.5">
          <div>
            <h2 className="display font-bold" style={{ fontSize: 16 }}>
              Cash collected — {periodLabel}
            </h2>
            {/* The series is settled payments, so the chart is a CASH chart.
                Calling it "Revenue · Cash · Profit" implied three series and
                claimed the bars were turnover; revenueSeries returns
                profit: 0 and cash: 0 unconditionally, so two of the three bars
                were always zero-height with "£0" tooltips, and the one real
                bar is cash, not the accrual turnover the KPI above shows. */}
            <p className="text-ink-muted" style={{ fontSize: 11 }}>
              Real settled payments per month · not the accrual turnover above
            </p>
          </div>
          <div className="flex gap-3" style={{ fontSize: 11 }}>
            {[
              { c: BRAND, l: 'Cash collected' },
            ].map((x) => (
              <div key={x.l} className="flex items-center gap-1">
                <div
                  style={{
                    width: 10,
                    height: 10,
                    background: x.c,
                    borderRadius: 2,
                  }}
                />
                {x.l}
              </div>
            ))}
            <div className="flex items-center gap-1">
              <div style={{ width: 14, height: 2, background: AMB }} />
              Target {targetMargin}%
            </div>
            {v.hasCostModel && (
              <div className="flex items-center gap-1">
                <div style={{ width: 14, height: 2, background: NEG }} />
                Break-even
              </div>
            )}
          </div>
        </div>
        {seriesLoading ? (
          <Skeleton className="w-full" style={{ height: 240 }} />
        ) : v.chartSeries.length === 0 ? (
          <div
            className="text-ink-muted"
            style={{ fontSize: 12, padding: '40px 0' }}
          >
            No settled payments in this period.
          </div>
        ) : (
          <div
            className="flex gap-1.5 items-end"
            style={{ height: 200, paddingBottom: 24, position: 'relative' }}
          >
            {v.chartSeries.map((s) => {
              const rh = (s.revenue / v.chartMax) * 100;
              const th = (s.target / v.chartMax) * 100;
              const bh = (s.be / v.chartMax) * 100;
              return (
                <div
                  key={s.month}
                  className="flex flex-col items-center"
                  style={{
                    flex: 1,
                    gap: 2,
                    position: 'relative',
                    height: '100%',
                  }}
                >
                  <div
                    className="flex justify-center items-end"
                    style={{
                      position: 'relative',
                      flex: 1,
                      width: '100%',
                      gap: 1,
                    }}
                  >
                    <div
                      title={`Cash collected: ${ccPoundsFull(s.revenue)}`}
                      style={{
                        width: '60%',
                        height: `${rh}%`,
                        background: BRAND,
                        borderRadius: '2px 2px 0 0',
                      }}
                    />
                    <div
                      style={{
                        position: 'absolute',
                        bottom: `${th}%`,
                        left: '5%',
                        right: '5%',
                        height: 2,
                        background: AMB,
                        opacity: 0.8,
                      }}
                    />
                    {/* Break-even reference line. Gated: without a real cost
                        model `be` is 0, which would draw a red "break-even"
                        rule flat along the axis — a fabricated line claiming
                        this group breaks even at £0. */}
                    {v.hasCostModel && (
                      <div
                        style={{
                          position: 'absolute',
                          bottom: `${bh}%`,
                          left: '5%',
                          right: '5%',
                          height: 2,
                          background: NEG,
                          opacity: 0.8,
                        }}
                      />
                    )}
                  </div>
                  <div
                    className="text-ink-muted"
                    style={{ position: 'absolute', bottom: -22, fontSize: 9 }}
                  >
                    {s.month.substring(5)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Lead funnel + cash position */}
      <div className="grid gap-3.5" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="card card-padded">
          <h2
            className="display font-bold"
            style={{ fontSize: 14, marginBottom: 4 }}
          >
            Lead funnel — {periodLabel}
          </h2>
          <p
            className="text-ink-muted"
            style={{ fontSize: 11, marginBottom: 12 }}
          >
            {leadsLoading
              ? 'Loading leads…'
              : v.totalLeads === 0
                ? `No leads in this period`
                : `${v.totalLeads.toLocaleString('en-GB')} leads · ${
                    v.convRate === null ? '—' : `${v.convRate}%`
                  } conv → ${v.treatmentStarted} started · ${v.lostLeads.toLocaleString('en-GB')} lost`}
          </p>
          {v.funnel.map((s, i) => {
            const pct = (s.count / v.fmax) * 100;
            const conv =
              i === 0
                ? 100
                : v.funnel[0].count === 0
                  ? 0
                  : ((s.count / v.funnel[0].count) * 100).toFixed(0);
            return (
              <div
                key={s.key}
                className="flex items-center gap-2.5"
                style={{ marginBottom: 6 }}
              >
                <div
                  className="text-ink-muted"
                  style={{ width: 130, fontSize: 11 }}
                >
                  {s.label}
                </div>
                <div
                  className="bg-bg flex items-center"
                  style={{ flex: 1, borderRadius: 4, height: 22 }}
                >
                  <div
                    className="flex items-center text-white font-bold"
                    style={{
                      height: '100%',
                      width: `${Math.max(pct, 6)}%`,
                      background: BRAND,
                      paddingLeft: 8,
                      fontSize: 11,
                    }}
                  >
                    {s.count}
                  </div>
                </div>
                <div
                  className="text-right font-bold"
                  style={{ width: 36, fontSize: 11 }}
                >
                  {conv}%
                </div>
              </div>
            );
          })}
        </div>

        <div className="card card-padded">
          <h2
            className="display font-bold"
            style={{ fontSize: 14, marginBottom: 4 }}
          >
            Cash position — {periodLabel}
          </h2>
          <p
            className="text-ink-muted"
            style={{ fontSize: 11, marginBottom: 10 }}
          >
            {v.cashflow === null
              ? 'Real settled payments · connect accounting for costs, cashflow and reserve'
              : `Real settled payments less real costs · ${v.monthsCovered}-month window`}
          </p>
          {/* Every row here is either computed from the row above it or
              labelled as a separate figure. It previously read as a running
              statement — cash − costs = operating cashflow − reserve = excess —
              while "operating cashflow" and "excess cash" were both just the
              bank balance, so the sums shown did not follow from the rows
              shown. A blank is honest; a £0 on a cash line is not. */}
          <table style={{ width: '100%', fontSize: 12 }}>
            <tbody>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '7px 0' }}>Turnover</td>
                <td className="text-right font-bold" style={{ padding: '7px 0' }}>
                  {ccPoundsFull(v.rev)}
                </td>
              </tr>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '7px 0' }}>Cash collected</td>
                <td className="text-right font-bold" style={{ padding: '7px 0', color: POS }}>
                  {ccPoundsFull(v.cash)}
                </td>
              </tr>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '7px 0' }}>Less: costs</td>
                <td className="text-right" style={{ padding: '7px 0', color: v.opEx ? NEG : undefined }}>
                  {v.cashflow === null ? (
                    <span className="text-ink-muted">not connected</span>
                  ) : (
                    `(${ccPoundsFull(v.opEx)})`
                  )}
                </td>
              </tr>
              <tr style={{ borderBottom: '2px solid #1F2937' }}>
                <td className="font-bold" style={{ padding: '7px 0' }}>
                  Operating cashflow
                </td>
                <td
                  className="text-right font-bold"
                  style={{ padding: '7px 0', color: v.cashflow === null ? undefined : v.cashflow >= 0 ? POS : NEG }}
                >
                  {v.cashflow === null ? (
                    <span className="text-ink-muted">—</span>
                  ) : (
                    ccPoundsFull(v.cashflow)
                  )}
                </td>
              </tr>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '7px 0' }}>
                  2mo cost reserve
                  <span className="text-ink-muted" style={{ fontSize: 10 }}> · target</span>
                </td>
                <td className="text-right" style={{ padding: '7px 0' }}>
                  {v.reserve === null ? (
                    <span className="text-ink-muted">—</span>
                  ) : (
                    ccPoundsFull(v.reserve)
                  )}
                </td>
              </tr>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '7px 0' }}>
                  Cash at bank
                  <span className="text-ink-muted" style={{ fontSize: 10 }}> · indicative</span>
                </td>
                <td className="text-right font-bold" style={{ padding: '7px 0' }}>
                  {v.bankBalance === null ? (
                    <span className="text-ink-muted">—</span>
                  ) : (
                    ccPoundsFull(v.bankBalance)
                  )}
                </td>
              </tr>
              <tr style={{ background: v.excess === null ? undefined : `${POS}15` }}>
                <td className="display font-bold" style={{ padding: '9px 8px', fontSize: 13 }}>
                  Excess cash
                  <div className="text-ink-muted" style={{ fontSize: 10, fontWeight: 400 }}>
                    Bank less the 2-month reserve
                  </div>
                </td>
                <td
                  className="display font-bold text-right"
                  style={{ padding: '9px 8px', fontSize: 17, color: v.excess === null ? undefined : v.excess >= 0 ? POS : NEG }}
                >
                  {v.excess === null ? (
                    <span className="text-ink-muted" style={{ fontSize: 13 }}>—</span>
                  ) : (
                    ccPoundsFull(v.excess)
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
