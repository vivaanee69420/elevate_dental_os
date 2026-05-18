'use client';
// Command Centre — pixel-faithful port of preview/elevate-dental-os-v2.html
// (PAGES.dashboard override). Fed by the mock-data layer (../mock); swap to
// real backend endpoints when per-practice financials / monthly series /
// editable P&L model exist server-side. The health banner uses the real
// useHealth hook today since that endpoint exists.
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useHealth } from '@/features/health/hooks';
import {
  PRACTICES,
  STAGES,
  SAMPLE_LEADS,
  DEFAULT_PL_TEMPLATE,
  getPracticeFinancials,
  calcPL,
  getRangeMonths,
  rangeLabel,
  ccPounds,
  ccPoundsFull,
  type DateRange,
} from '../mock';

const POS = '#10B981';
const NEG = '#EF4444';
const AMB = '#F59E0B';
const BRAND = '#0E7C7B';

const RANGES: { k: DateRange; l: string }[] = [
  { k: 'mtd', l: 'MTD' },
  { k: 'qtd', l: 'QTD' },
  { k: '6m', l: '6M' },
  { k: 'ytd', l: 'YTD' },
];

function shortName(p: string) {
  return p === 'All practices'
    ? 'All'
    : p
        .replace(' Dental', '')
        .replace(' Implant Centre', ' Implant')
        .replace('Fixed Teeth Solutions ', '')
        .replace(' Solutions', '');
}

export default function DashboardScreen() {
  const { data: health } = useHealth();
  const healthComplete = !!health?.setup_completed;

  const [selected, setSelected] = useState<string>('All practices');
  const [range, setRange] = useState<DateRange>('ytd');
  const [targetMargin, setTargetMargin] = useState<number>(DEFAULT_PL_TEMPLATE.targetMargin);

  const practiceList = ['All practices', ...PRACTICES];

  const view = useMemo(() => {
    const rangeSeries = getRangeMonths(range);
    const pl = { ...DEFAULT_PL_TEMPLATE, targetMargin };
    const calc = calcPL(pl);
    const TM = pl.targetMargin / 100;

    const fin = getPracticeFinancials(selected);
    const w = fin.weight;
    const rangeRev = rangeSeries.reduce((s, m) => s + m.revenue * w.rev, 0);
    const rangeCash = rangeRev * w.cashConvPct;
    const rangeOpEx = rangeRev * w.opExPct;
    const rangeProfit = rangeRev * w.profitPct;
    const rangeCashflow = rangeCash - rangeOpEx;
    const rangeReserve = (rangeOpEx / rangeSeries.length) * 2;
    const rangeExcess = Math.max(0, rangeCashflow - rangeReserve);
    const rangeTarget = rangeRev * TM;
    const rangeGap = rangeTarget - rangeProfit;
    const rangeMargin = rangeRev ? (rangeProfit / rangeRev) * 100 : 0;

    const firstM = rangeSeries[0]?.month || '';
    const lastM = rangeSeries[rangeSeries.length - 1]?.month || '';
    const dateLabel = rangeSeries.length === 1 ? firstM : `${firstM} → ${lastM}`;

    const cutoff30 = new Date(Date.now() - 30 * 86400000);
    let recent = SAMPLE_LEADS.filter((l) => new Date(l.created) >= cutoff30);
    if (selected !== 'All practices') recent = recent.filter((l) => l.practice === selected);
    const totalLeads = recent.length;
    const treatmentStarted = recent.filter((l) =>
      ['treatment_started', 'treatment_completed'].includes(l.status)
    ).length;
    const convRate = totalLeads ? ((treatmentStarted / totalLeads) * 100).toFixed(1) : '0';

    const lastVal = (rangeSeries[rangeSeries.length - 1]?.revenue || 0) * w.rev;
    const prevVal = (rangeSeries[rangeSeries.length - 2]?.revenue || 0) * w.rev;
    const momDelta = prevVal ? ((lastVal - prevVal) / prevVal) * 100 : 0;

    const practiceMultiplier = selected === 'All practices' ? PRACTICES.length : 1;
    const beAnnual = calc.breakeven * practiceMultiplier;
    const beMonthly = beAnnual / 12;
    const annualisedRev = (rangeRev / rangeSeries.length) * 12;
    const beCoverage = beAnnual > 0 ? (annualisedRev / beAnnual) * 100 : 100;

    const kpis = [
      {
        icon: '📈',
        label: 'Turnover',
        value: ccPounds(rangeRev),
        sub: `${dateLabel} · ${momDelta >= 0 ? '+' : ''}${momDelta.toFixed(1)}% MoM`,
        colour: momDelta >= 0 ? POS : NEG,
        link: '/cashflow',
      },
      {
        icon: '💵',
        label: 'Cash collected',
        value: ccPounds(rangeCash),
        sub: `${((rangeCash / rangeRev) * 100).toFixed(0)}% of turnover · ${
          rangeRev > 0 ? ccPounds(rangeRev - rangeCash) : '£0'
        } outstanding`,
        colour: POS,
        link: '/payments',
      },
      {
        icon: '📊',
        label: 'Net profit',
        value: ccPounds(rangeProfit),
        sub: `${rangeMargin.toFixed(1)}% margin · ${
          rangeMargin >= targetMargin ? '✓ above target' : 'below target'
        }`,
        colour: rangeMargin >= targetMargin ? POS : rangeMargin >= targetMargin * 0.75 ? AMB : NEG,
        link: '/profit',
      },
      {
        icon: '💧',
        label: 'Cashflow',
        value: ccPounds(rangeCashflow),
        sub: `Cash − OpEx · ${ccPounds(rangeOpEx)} OpEx`,
        colour: rangeCashflow > 0 ? POS : NEG,
        link: '/cashflow',
      },
      {
        icon: '🏦',
        label: 'Excess cash',
        value: ccPounds(rangeExcess),
        sub: `After ${ccPounds(rangeReserve)} reserve`,
        colour: POS,
        link: '/financial',
      },
      {
        icon: '🎯',
        label: `Target profit @${targetMargin.toFixed(1)}%`,
        value: ccPounds(rangeTarget),
        sub: rangeGap > 0 ? `${ccPounds(rangeGap)} gap to hit target` : `✓ ${ccPounds(-rangeGap)} over target`,
        colour: rangeGap > 0 ? AMB : POS,
        link: '/profit',
      },
    ];

    const perPracticeStrip =
      selected === 'All practices'
        ? PRACTICES.map((p) => {
            const f = getPracticeFinancials(p);
            return {
              name: p,
              turnover: f.annual.turnover,
              profitPct: f.annual.profitPct,
              hit: f.annual.profitPct >= TM,
            };
          })
        : [];

    const chartSeries = rangeSeries.map((s) => ({
      month: s.month,
      revenue: Math.round(s.revenue * w.rev),
      profit: Math.round(s.revenue * w.rev * w.profitPct),
      cash: Math.round(s.revenue * w.rev * w.cashConvPct),
      target: Math.round(s.revenue * w.rev * TM),
      be: beMonthly,
    }));
    const chartMax = Math.max(...chartSeries.map((s) => Math.max(s.revenue, s.be)));

    const allStages = [...STAGES.map((x) => x.key), 'treatment_completed'];
    const funnel = STAGES.map((s, i) => ({
      ...s,
      count: recent.filter((l) => allStages.slice(i).includes(l.status)).length,
    }));
    const fmax = Math.max(...funnel.map((s) => s.count), 1);

    const beW = chartMax ? Math.min(100, (beAnnual / (Math.max(beAnnual, calc.revAtTarget ? calc.revAtTarget * practiceMultiplier : 0, annualisedRev) * 1.05)) * 100) : 0;
    const scaleMax = Math.max(beAnnual, calc.revAtTarget ? calc.revAtTarget * practiceMultiplier : 0, annualisedRev) * 1.05;
    const beBarW = scaleMax ? (beAnnual / scaleMax) * 100 : 0;
    const targetBarW = calc.revAtTarget && scaleMax ? ((calc.revAtTarget * practiceMultiplier) / scaleMax) * 100 : 0;
    const actualBarW = scaleMax ? (annualisedRev / scaleMax) * 100 : 0;

    return {
      rangeSeries,
      calc,
      rangeRev,
      rangeCash,
      rangeOpEx,
      rangeCashflow,
      rangeReserve,
      rangeExcess,
      rangeMargin,
      dateLabel,
      totalLeads,
      treatmentStarted,
      convRate,
      beAnnual,
      beMonthly,
      beCoverage,
      annualisedRev,
      practiceMultiplier,
      kpis,
      perPracticeStrip,
      chartSeries,
      chartMax,
      funnel,
      fmax,
      beBarW,
      targetBarW,
      actualBarW,
      TM,
    };
  }, [selected, range, targetMargin, health]);

  const v = view;

  return (
    <div className="mx-auto" style={{ maxWidth: 1500 }}>
      {!healthComplete && (
        <div
          className="text-white flex items-center gap-4 mb-4"
          style={{ background: 'linear-gradient(135deg, #0E7C7B 0%, #085857 100%)', padding: '16px 22px', borderRadius: 12 }}
        >
          <div style={{ fontSize: 22 }}>🎯</div>
          <div className="flex-1">
            <div className="display font-bold" style={{ fontSize: 15 }}>
              Set up Business Health baseline
            </div>
            <div style={{ fontSize: 11, opacity: 0.9 }}>Capture where you are today</div>
          </div>
          <Link
            href="/health-setup"
            className="font-bold"
            style={{ background: 'white', color: BRAND, padding: '8px 16px', borderRadius: 8, fontSize: 12 }}
          >
            Start →
          </Link>
        </div>
      )}

      {/* Header */}
      <div className="mb-3">
        <div className="flex justify-between items-end gap-3 flex-wrap">
          <div>
            <h1 className="display font-bold" style={{ fontSize: 28 }}>
              Command Centre
            </h1>
            <p className="text-ink-muted" style={{ fontSize: 13 }}>
              {selected === 'All practices' ? 'GM Dental Group · 5 practices' : selected} · {rangeLabel(range)} ({v.dateLabel})
            </p>
          </div>
          <div className="text-right">
            <div
              className="text-ink-muted font-bold uppercase"
              style={{ fontSize: 10, letterSpacing: '0.05em' }}
            >
              {rangeLabel(range)} revenue
            </div>
            <div className="display font-bold text-brand" style={{ fontSize: 28, lineHeight: 1 }}>
              {ccPounds(v.rangeRev)}
            </div>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div
        className="bg-bg flex gap-4 items-center flex-wrap mb-4"
        style={{ borderRadius: 10, padding: 10 }}
      >
        <div className="flex gap-1.5 items-center flex-wrap">
          <span className="text-ink-muted font-bold uppercase" style={{ fontSize: 10 }}>
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
                border: `1px solid ${selected === p ? BRAND : '#E5E7EB'}`,
                background: selected === p ? BRAND : 'white',
                color: selected === p ? 'white' : '#1F2937',
              }}
            >
              {shortName(p)}
            </button>
          ))}
        </div>

        <div
          className="flex gap-1 items-center"
          style={{ borderLeft: '1px solid #E5E7EB', paddingLeft: 14 }}
        >
          <span className="text-ink-muted font-bold uppercase" style={{ fontSize: 10 }}>
            📅 Period:
          </span>
          {RANGES.map((r) => (
            <button
              key={r.k}
              onClick={() => setRange(r.k)}
              className="font-bold"
              style={{
                padding: '6px 11px',
                borderRadius: 5,
                fontSize: 11,
                border: `1px solid ${range === r.k ? BRAND : '#E5E7EB'}`,
                background: range === r.k ? BRAND : 'white',
                color: range === r.k ? 'white' : '#1F2937',
              }}
            >
              {r.l}
            </button>
          ))}
        </div>

        <div
          className="flex gap-1.5 items-center"
          style={{ borderLeft: '1px solid #E5E7EB', paddingLeft: 14 }}
        >
          <span className="text-ink-muted font-bold uppercase" style={{ fontSize: 10 }}>
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
            style={{ width: 60, padding: '5px 8px', border: '1px solid #E5E7EB', borderRadius: 5, fontSize: 12 }}
          />
          <span className="font-bold" style={{ fontSize: 12 }}>
            %
          </span>
          <Link
            href="/profit"
            className="font-bold"
            style={{ padding: '6px 11px', borderRadius: 5, fontSize: 11, border: '1px solid #E5E7EB', background: 'white', color: '#1F2937' }}
          >
            Edit P&amp;L
          </Link>
        </div>
      </div>

      {/* 6 KPIs */}
      <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
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
                style={{ width: 42, height: 42, background: `${k.colour}15`, borderRadius: 10, fontSize: 20 }}
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
                  style={{ fontSize: 26, color: k.colour, lineHeight: 1.1, margin: '4px 0 2px' }}
                >
                  {k.value}
                </div>
                <div className="text-ink-muted" style={{ fontSize: 10, lineHeight: 1.4 }}>
                  {k.sub}
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {/* Break-even · Target · Actual */}
      <div className="card card-padded mb-4">
        <div className="flex justify-between items-end mb-3 flex-wrap gap-2">
          <div>
            <h2 className="display font-bold" style={{ fontSize: 16 }}>
              Break-even · Target · Actual
            </h2>
            <p className="text-ink-muted" style={{ fontSize: 11 }}>
              {selected === 'All practices' ? 'Group-wide annualised' : `${selected} annualised`} · derived from
              your editable P&amp;L model
            </p>
          </div>
          <Link
            href="/profit"
            className="font-bold"
            style={{ padding: '7px 12px', borderRadius: 6, fontSize: 11, border: '1px solid #E5E7EB', background: 'white' }}
          >
            Edit P&amp;L target →
          </Link>
        </div>

        <div
          className="bg-bg"
          style={{ position: 'relative', height: 56, borderRadius: 8, margin: '32px 0' }}
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
            style={{ position: 'absolute', left: `${v.beBarW}%`, top: -10, bottom: -10, width: 3, background: NEG, zIndex: 2 }}
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
            ⚠ BE {ccPounds(v.beAnnual)}
          </div>
          {v.calc.revAtTarget && (
            <>
              <div
                style={{ position: 'absolute', left: `${v.targetBarW}%`, top: -10, bottom: -10, width: 3, background: AMB, zIndex: 2 }}
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
                🎯 @{targetMargin}% {ccPounds(v.calc.revAtTarget * v.practiceMultiplier)}
              </div>
            </>
          )}
        </div>

        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(4, 1fr)', fontSize: 11 }}>
          {[
            {
              label: 'Break-even revenue',
              big: `${ccPounds(v.beAnnual)}/yr`,
              bigColour: NEG,
              sub: `${ccPounds(v.beMonthly)}/mo · covered by ${v.beCoverage.toFixed(0)}%`,
            },
            {
              label: 'Contribution margin',
              big: `${v.calc.contributionMargin.toFixed(1)}%`,
              sub: `£1 sales → ${(v.calc.contributionMargin / 100).toFixed(2)} contribution`,
            },
            {
              label: `Revenue to hit ${targetMargin}%`,
              big: v.calc.revAtTarget ? `${ccPounds(v.calc.revAtTarget * v.practiceMultiplier)}/yr` : 'N/A',
              bigColour: AMB,
              sub: v.calc.revAtTarget
                ? `${ccPounds((v.calc.revAtTarget * v.practiceMultiplier) / 12)}/mo`
                : 'increase margin or cut fixed',
            },
            {
              label: 'Margin actual vs target',
              big: `${v.rangeMargin.toFixed(1)}% / ${targetMargin}%`,
              bigColour: v.rangeMargin >= targetMargin ? POS : AMB,
              sub:
                v.rangeMargin >= targetMargin
                  ? '✓ above target'
                  : `gap ${(targetMargin - v.rangeMargin).toFixed(1)} pts`,
            },
          ].map((c) => (
            <div key={c.label} className="bg-bg" style={{ padding: 10, borderRadius: 6 }}>
              <div className="text-ink-muted uppercase font-bold" style={{ fontSize: 9 }}>
                {c.label}
              </div>
              <div className="display font-bold" style={{ fontSize: 15, color: c.bigColour }}>
                {c.big}
              </div>
              <div className="text-ink-muted" style={{ fontSize: 10 }}>
                {c.sub}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Per-practice scorecard */}
      {selected === 'All practices' && (
        <div className="card card-padded mb-4">
          <div className="flex justify-between items-center mb-2.5">
            <h2 className="display font-bold" style={{ fontSize: 16 }}>
              Per-practice scorecard
            </h2>
            <span className="text-ink-muted" style={{ fontSize: 11 }}>
              Click to drill in · target {targetMargin}%
            </span>
          </div>
          <div
            className="grid gap-2"
            style={{ gridTemplateColumns: `repeat(${v.perPracticeStrip.length}, 1fr)` }}
          >
            {v.perPracticeStrip.map((p) => (
              <button
                key={p.name}
                onClick={() => setSelected(p.name)}
                className="text-left"
                style={{ padding: 12, border: '1px solid #E5E7EB', borderRadius: 8, background: 'white' }}
              >
                <div className="font-bold" style={{ fontSize: 11, lineHeight: 1.3, marginBottom: 8, minHeight: 30 }}>
                  {p.name}
                </div>
                <div className="display font-bold text-brand" style={{ fontSize: 18 }}>
                  {ccPounds(p.turnover)}
                </div>
                <div className="text-ink-muted" style={{ fontSize: 10, marginTop: 2 }}>
                  {(p.profitPct * 100).toFixed(1)}% margin
                </div>
                <div className="bg-bg" style={{ marginTop: 8, height: 6, borderRadius: 3, overflow: 'hidden' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${Math.min(100, (p.profitPct / v.TM) * 100)}%`,
                      background: p.hit ? POS : AMB,
                    }}
                  />
                </div>
                <div
                  className="font-bold uppercase"
                  style={{ fontSize: 9, marginTop: 4, color: p.hit ? POS : AMB }}
                >
                  {p.hit ? '✓ Target hit' : `${((p.profitPct / v.TM) * 100).toFixed(0)}% of target`}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 12-month chart */}
      <div className="card card-padded mb-4">
        <div className="flex justify-between items-center mb-3.5">
          <div>
            <h2 className="display font-bold" style={{ fontSize: 16 }}>
              Revenue · Cash · Profit — {rangeLabel(range)}
            </h2>
            <p className="text-ink-muted" style={{ fontSize: 11 }}>
              {selected === 'All practices' ? 'All 5 practices' : selected}
            </p>
          </div>
          <div className="flex gap-3" style={{ fontSize: 11 }}>
            {[
              { c: BRAND, l: 'Revenue' },
              { c: '#3B82F6', l: 'Cash' },
              { c: POS, l: 'Profit' },
            ].map((x) => (
              <div key={x.l} className="flex items-center gap-1">
                <div style={{ width: 10, height: 10, background: x.c, borderRadius: 2 }} />
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
                style={{ flex: 1, gap: 2, position: 'relative', height: '100%' }}
              >
                <div
                  className="flex justify-center items-end"
                  style={{ position: 'relative', flex: 1, width: '100%', gap: 1 }}
                >
                  <div title={`Revenue: ${ccPoundsFull(s.revenue)}`} style={{ width: '28%', height: `${rh}%`, background: BRAND, borderRadius: '2px 2px 0 0' }} />
                  <div title={`Cash: ${ccPoundsFull(s.cash)}`} style={{ width: '28%', height: `${ch}%`, background: '#3B82F6', borderRadius: '2px 2px 0 0' }} />
                  <div title={`Profit: ${ccPoundsFull(s.profit)}`} style={{ width: '28%', height: `${ph}%`, background: POS, borderRadius: '2px 2px 0 0' }} />
                  <div style={{ position: 'absolute', bottom: `${th}%`, left: '5%', right: '5%', height: 2, background: AMB, opacity: 0.8 }} />
                  <div style={{ position: 'absolute', bottom: `${bh}%`, left: '5%', right: '5%', height: 2, background: NEG, opacity: 0.8 }} />
                </div>
                <div className="text-ink-muted" style={{ position: 'absolute', bottom: -22, fontSize: 9 }}>
                  {s.month.substring(5)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Lead funnel + cash position */}
      <div className="grid gap-3.5" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="card card-padded">
          <h2 className="display font-bold" style={{ fontSize: 14, marginBottom: 4 }}>
            Lead funnel — last 30 days
          </h2>
          <p className="text-ink-muted" style={{ fontSize: 11, marginBottom: 12 }}>
            {v.totalLeads} leads · {v.convRate}% conv → {v.treatmentStarted} started
          </p>
          {v.funnel.map((s, i) => {
            const pct = (s.count / v.fmax) * 100;
            const conv =
              i === 0 ? 100 : v.funnel[0].count === 0 ? 0 : ((s.count / v.funnel[0].count) * 100).toFixed(0);
            return (
              <div key={s.key} className="flex items-center gap-2.5" style={{ marginBottom: 6 }}>
                <div className="text-ink-muted" style={{ width: 130, fontSize: 11 }}>
                  {s.label}
                </div>
                <div className="bg-bg flex items-center" style={{ flex: 1, borderRadius: 4, height: 22 }}>
                  <div
                    className="flex items-center text-white font-bold"
                    style={{ height: '100%', width: `${Math.max(pct, 6)}%`, background: BRAND, paddingLeft: 8, fontSize: 11 }}
                  >
                    {s.count}
                  </div>
                </div>
                <div className="text-right font-bold" style={{ width: 36, fontSize: 11 }}>
                  {conv}%
                </div>
              </div>
            );
          })}
        </div>

        <div className="card card-padded">
          <h2 className="display font-bold" style={{ fontSize: 14, marginBottom: 4 }}>
            Cash position — {rangeLabel(range)}
          </h2>
          <p className="text-ink-muted" style={{ fontSize: 11, marginBottom: 10 }}>
            {selected === 'All practices' ? 'Group-wide' : selected}
          </p>
          <table style={{ width: '100%', fontSize: 12 }}>
            <tbody>
              <tr style={{ borderBottom: '1px solid #E5E7EB' }}>
                <td style={{ padding: '7px 0' }}>Turnover</td>
                <td className="text-right font-bold" style={{ padding: '7px 0' }}>
                  {ccPoundsFull(v.rangeRev)}
                </td>
              </tr>
              <tr style={{ borderBottom: '1px solid #E5E7EB' }}>
                <td style={{ padding: '7px 0' }}>Cash collected</td>
                <td className="text-right font-bold" style={{ padding: '7px 0', color: POS }}>
                  {ccPoundsFull(v.rangeCash)}
                </td>
              </tr>
              <tr style={{ borderBottom: '1px solid #E5E7EB' }}>
                <td style={{ padding: '7px 0' }}>Less: OpEx</td>
                <td className="text-right" style={{ padding: '7px 0', color: NEG }}>
                  ({ccPoundsFull(v.rangeOpEx)})
                </td>
              </tr>
              <tr style={{ borderBottom: '2px solid #1F2937' }}>
                <td className="font-bold" style={{ padding: '7px 0' }}>
                  Operating cashflow
                </td>
                <td className="text-right font-bold" style={{ padding: '7px 0' }}>
                  {ccPoundsFull(v.rangeCashflow)}
                </td>
              </tr>
              <tr style={{ borderBottom: '1px solid #E5E7EB' }}>
                <td style={{ padding: '7px 0' }}>Less: 2mo OpEx reserve</td>
                <td className="text-right" style={{ padding: '7px 0', color: NEG }}>
                  ({ccPoundsFull(v.rangeReserve)})
                </td>
              </tr>
              <tr style={{ background: `${POS}15` }}>
                <td className="display font-bold" style={{ padding: '9px 8px', fontSize: 13 }}>
                  Excess cash
                </td>
                <td
                  className="display font-bold text-right"
                  style={{ padding: '9px 8px', fontSize: 17, color: POS }}
                >
                  {ccPoundsFull(v.rangeExcess)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
