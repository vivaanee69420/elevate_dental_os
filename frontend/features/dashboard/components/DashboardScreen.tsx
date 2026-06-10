'use client';
// Command Centre — real-data wired. No fabricated weights or synthetic
// dataset. Sources:
//   • KPIs + cash position  ← GET /api/analytics/dashboard-summary (baseline)
//   • 12-month chart        ← GET /api/analytics/revenue-series (baseline
//                              projection — derived, NOT live history)
//   • Per-practice scorecard← GET /api/analytics/practice-summary (real
//                              practices + settled payments; margin is the
//                              group baseline margin, flagged group-derived)
//   • Lead funnel           ← GET /api/leads (real)
//   • Setup banner          ← GET /api/health (real setup_completed)
// The editable P&L (break-even/target) stays a CLIENT what-if tool, seeded
// from the real baseline. The range selector windows the chart only — KPIs
// are the real annual baseline figures, never range-scaled fabrications.
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useHealth } from '@/features/health/hooks';
import { useLeads } from '@/features/leads/hooks';
import { useMarketingRoi } from '@/features/growth/hooks';
import { formatPence as fmtPence } from '@/lib/format';
import { usePractices } from '@/features/practices/hooks';
import {
  useDashboardSummary,
  useRevenueSeries,
  usePracticeSummary,
} from '../hooks';
import {
  STAGES,
  DEFAULT_PL_TEMPLATE,
  calcPL,
  rangeLabel,
  ccPounds,
  ccPoundsFull,
  type DateRange,
  type Lead,
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

function toLead(row: any): Lead {
  return {
    id: row.id,
    practice: row.practice?.name ?? '—',
    status: row.status,
    created: row.created_at ?? row.created ?? new Date().toISOString(),
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
  const allPractices: { id: string; name: string }[] = practicesData?.practices ?? [];
  const selectedId = selected === 'All practices'
    ? null
    : allPractices.find((p) => p.name === selected)?.id ?? null;

  const { data: summary, isLoading: sumLoading } = useDashboardSummary(period, selectedId);
  const { data: seriesResp, isLoading: seriesLoading } = useRevenueSeries(period, selectedId);
  const { data: practiceResp, isLoading: practiceLoading } =
    usePracticeSummary();
  const { data: leadsResp, isLoading: leadsLoading } = useLeads();
  const { data: roi } = useMarketingRoi();

  const leads: Lead[] = useMemo(
    () => (leadsResp?.leads ?? []).map(toLead),
    [leadsResp],
  );

  const noBaseline = !!summary?.error;

  const [targetMargin, setTargetMargin] = useState<number>(
    DEFAULT_PL_TEMPLATE.targetMargin,
  );

  const practiceNames = useMemo(() => allPractices.map((p) => p.name), [allPractices]);
  const practiceList = ['All practices', ...practiceNames];

  const v = useMemo(() => {
    const TM = targetMargin / 100;
    const pl = seededPL(health?.baseline, targetMargin);
    const calc = calcPL(pl);

    // Real annual figures (whole pounds) from the baseline summary.
    const rev = summary?.revenue ?? 0;
    const profit = summary?.netProfit ?? 0;
    const cash = summary?.cashCollected ?? 0;
    const opEx = summary?.totalCosts ?? 0;
    const cashflow = summary?.cashflow ?? 0;
    const reserve = summary?.reserve ?? 0;
    const excess = summary?.excessCash ?? 0;
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
      be: calc.breakeven / 12,
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
    const annualisedRev = rev;
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
        sub: `${periodLabel} · ${
          summary?.turnoverBasis === 'billed'
            ? 'invoiced production'
            : summary?.turnoverBasis === 'actuals'
              ? 'Xero actuals'
              : 'real settled payments'
        }`,
        colour: POS,
        link: '/cashflow',
      },
      {
        icon: '💵',
        label: 'Cash collected',
        value: ccPounds(cash),
        sub: rev > 0 ? `${((cash / rev) * 100).toFixed(0)}% of turnover` : '—',
        colour: POS,
        link: '/payments',
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
        icon: '💧',
        label: 'Cashflow',
        value: ccPounds(cashflow),
        sub: `Cash − costs · ${ccPounds(opEx)} costs`,
        colour: cashflow > 0 ? POS : NEG,
        link: '/cashflow',
      },
      {
        icon: '🏦',
        label: 'Excess cash',
        value: ccPounds(excess),
        sub: `After ${ccPounds(reserve)} reserve`,
        colour: POS,
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

    const scorecard = (practiceResp?.practices ?? []).map((p) => ({
      name: p.name,
      turnover: p.turnover,
      margin: p.margin,
      hit: p.margin / 100 >= TM,
    }));

    // Lead funnel — real leads, last 30 days, optional practice filter.
    const cutoff30 = new Date(Date.now() - 30 * 86400000);
    let recent = leads.filter((l) => new Date(l.created) >= cutoff30);
    if (selected !== 'All practices')
      recent = recent.filter((l) => l.practice === selected);
    const totalLeads = recent.length;
    const treatmentStarted = recent.filter((l) =>
      ['treatment_started', 'treatment_completed'].includes(l.status),
    ).length;
    const convRate = totalLeads
      ? ((treatmentStarted / totalLeads) * 100).toFixed(1)
      : '0';
    const allStages = [...STAGES.map((x) => x.key), 'treatment_completed'];
    const funnel = STAGES.map((s, i) => ({
      ...s,
      count: recent.filter((l) => allStages.slice(i).includes(l.status)).length,
    }));
    const fmax = Math.max(...funnel.map((s) => s.count), 1);

    return {
      calc,
      rev,
      cash,
      opEx,
      cashflow,
      reserve,
      excess,
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
      convRate,
      funnel,
      fmax,
      TM,
    };
  }, [
    summary,
    seriesResp,
    practiceResp,
    leads,
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
              {periodLabel} turnover (real)
            </div>
            <div
              className="display font-bold text-brand"
              style={{ fontSize: 28, lineHeight: 1 }}
            >
              {sumLoading ? '…' : noBaseline ? '—' : ccPounds(v.rev)}
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

      {/* Break-even · Target · Actual */}
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

      {/* Per-practice scorecard (real turnover; margin group-derived) */}
      <div className="card card-padded mb-4">
        <div className="flex justify-between items-center mb-2.5">
          <h2 className="display font-bold" style={{ fontSize: 16 }}>
            Per-practice scorecard
          </h2>
          <span className="text-ink-muted" style={{ fontSize: 11 }}>
            Real settled-payment turnover · margin = group baseline · target{' '}
            {targetMargin}%
          </span>
        </div>
        {practiceLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-5 w-full" />
            ))}
          </div>
        ) : v.scorecard.length === 0 ? (
          <div className="text-ink-muted" style={{ fontSize: 12 }}>
            No practices with settled payments yet.
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
                  {p.margin.toFixed(1)}% margin
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
                  <div
                    style={{
                      height: '100%',
                      width: `${Math.min(100, v.TM ? (p.margin / 100 / v.TM) * 100 : 0)}%`,
                      background: p.hit ? POS : AMB,
                    }}
                  />
                </div>
                <div
                  className="font-bold uppercase"
                  style={{ fontSize: 9, marginTop: 4, color: p.hit ? POS : AMB }}
                >
                  {p.hit ? '✓ Target hit' : 'Below target'}
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
              Revenue · Cash · Profit — {periodLabel}
            </h2>
            <p className="text-ink-muted" style={{ fontSize: 11 }}>
              Real settled payments · {periodLabel} (profit/cash £0 until Xero)
            </p>
          </div>
          <div className="flex gap-3" style={{ fontSize: 11 }}>
            {[
              { c: BRAND, l: 'Revenue' },
              { c: '#3B82F6', l: 'Cash' },
              { c: POS, l: 'Profit' },
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
            <div className="flex items-center gap-1">
              <div style={{ width: 14, height: 2, background: NEG }} />
              Break-even
            </div>
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
              const ph = (s.profit / v.chartMax) * 100;
              const ch = (s.cash / v.chartMax) * 100;
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
                      title={`Revenue: ${ccPoundsFull(s.revenue)}`}
                      style={{
                        width: '28%',
                        height: `${rh}%`,
                        background: BRAND,
                        borderRadius: '2px 2px 0 0',
                      }}
                    />
                    <div
                      title={`Cash: ${ccPoundsFull(s.cash)}`}
                      style={{
                        width: '28%',
                        height: `${ch}%`,
                        background: '#3B82F6',
                        borderRadius: '2px 2px 0 0',
                      }}
                    />
                    <div
                      title={`Profit: ${ccPoundsFull(s.profit)}`}
                      style={{
                        width: '28%',
                        height: `${ph}%`,
                        background: POS,
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
            Lead funnel — last 30 days
          </h2>
          <p
            className="text-ink-muted"
            style={{ fontSize: 11, marginBottom: 12 }}
          >
            {leadsLoading
              ? 'Loading leads…'
              : v.totalLeads === 0
                ? 'No leads in the last 30 days'
                : `${v.totalLeads} leads · ${v.convRate}% conv → ${v.treatmentStarted} started`}
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
            Group-wide · real settled payments (costs £0 until Xero)
          </p>
          <table style={{ width: '100%', fontSize: 12 }}>
            <tbody>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '7px 0' }}>Turnover</td>
                <td
                  className="text-right font-bold"
                  style={{ padding: '7px 0' }}
                >
                  {ccPoundsFull(v.rev)}
                </td>
              </tr>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '7px 0' }}>Cash collected</td>
                <td
                  className="text-right font-bold"
                  style={{ padding: '7px 0', color: POS }}
                >
                  {ccPoundsFull(v.cash)}
                </td>
              </tr>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '7px 0' }}>Less: costs</td>
                <td
                  className="text-right"
                  style={{ padding: '7px 0', color: NEG }}
                >
                  ({ccPoundsFull(v.opEx)})
                </td>
              </tr>
              <tr style={{ borderBottom: '2px solid #1F2937' }}>
                <td className="font-bold" style={{ padding: '7px 0' }}>
                  Operating cashflow
                </td>
                <td
                  className="text-right font-bold"
                  style={{ padding: '7px 0' }}
                >
                  {ccPoundsFull(v.cashflow)}
                </td>
              </tr>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '7px 0' }}>Less: 2mo cost reserve</td>
                <td
                  className="text-right"
                  style={{ padding: '7px 0', color: NEG }}
                >
                  ({ccPoundsFull(v.reserve)})
                </td>
              </tr>
              <tr style={{ background: `${POS}15` }}>
                <td
                  className="display font-bold"
                  style={{ padding: '9px 8px', fontSize: 13 }}
                >
                  Excess cash
                </td>
                <td
                  className="display font-bold text-right"
                  style={{ padding: '9px 8px', fontSize: 17, color: POS }}
                >
                  {ccPoundsFull(v.excess)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
