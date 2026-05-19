'use client';
// Practice Valuation — pixel-faithful port of
// preview/elevate-dental-os-v2.html (PAGES.valuation + the valuation engine,
// updateValuation, the Sale Planner sub-tab and recomputePlanner). Two tabs:
//   - Current Valuation: three-model headline (Principal / Associate / DSO),
//     practice classification, EBITDA build-up + multiple sliders, detailed
//     breakdown, DSO buyer landscape, benchmarks and value-uplift levers.
//   - Sale Planner: target vs current, modelled future valuation, input
//     sliders, a "path to target" action-card grid and a year-by-year plan.
//
// The prototype mutates the DOM imperatively from slider handlers; this port
// instead holds all inputs in React state and recomputes derived figures with
// useMemo, which is the idiomatic React equivalent. Persistence (localStorage)
// is intentionally dropped — mock-only, no side effects.
//
// Data flow (Current tab):
//   FINANCE_SERIES ──> valuationBase() ──> { ttmRevenue, reportedEbitda }
//        + ValuationState (sliders) ──> calculateValuation()
//                                   ──> headline / breakdown / benchmarks / levers
//
// Data flow (Planner tab):
//   base + ValuationState ──> calculateValuation().midpoint (baseline)
//   PlannerState (sliders) ──> projected value, gap, CAGR, action cards,
//                              year-by-year interpolation table

import { useMemo, useState } from 'react';
import { useValuationBase } from '../hooks';
import {
  calculateValuation,
  defaultValuationState,
  getDefaultMultiples,
  poundsCompact,
  formatCurrency,
  PRACTICE_TYPE_MULTIPLES,
  DSO_TIER_MULTIPLIERS,
  DSO_TIER_INFO,
  REGION_ADJUSTMENTS,
  REGIONS_DISPLAY,
  type ValuationState,
  type PracticeType,
  type DsoTier,
  type RegionKey,
} from '../mock';

const BRAND = '#0E7C7B';
const SUCCESS = 'var(--success)';
const DANGER = 'var(--danger)';

// Coloured signed-variance text vs an industry benchmark (prototype renderVariance).
function variance(actual: number, benchmark: number, unit: 'x' | 'pp') {
  const diff = actual - benchmark;
  const colour = diff > 0 ? SUCCESS : diff < 0 ? DANGER : 'var(--ink-muted)';
  const sign = diff > 0 ? '+' : '';
  const display = unit === 'x' ? diff.toFixed(2) + 'x' : Math.abs(diff).toFixed(1) + 'pp';
  return (
    <span style={{ color: colour, fontWeight: 500 }}>
      {sign}
      {display}
    </span>
  );
}

// Coloured percent + absolute price variance vs a benchmark (prototype renderPriceVariance).
function priceVariance(actual: number, benchmark: number) {
  const diff = actual - benchmark;
  const pct = ((diff / benchmark) * 100).toFixed(0);
  const colour = diff > 0 ? SUCCESS : DANGER;
  const sign = diff > 0 ? '+' : '';
  return (
    <span style={{ color: colour, fontWeight: 500 }}>
      {sign}
      {pct}% ({sign}
      {poundsCompact(diff)})
    </span>
  );
}

// A labelled slider row used throughout the valuation/planner forms.
function SliderRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
  help,
}: {
  label: string;
  value: string;
  min: number;
  max: number;
  step: number;
  onChange: (n: number) => void;
  help?: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div className="flex justify-between items-center" style={{ marginBottom: 6 }}>
        <label className="text-ink-muted" style={{ fontSize: 12, fontWeight: 600 }}>
          {label}
        </label>
        <span className="font-semibold" style={{ fontSize: 13 }}>
          {value}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={parseFloat(value.replace(/[^0-9.-]/g, '')) || min}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ width: '100%', accentColor: BRAND }}
      />
      {help && (
        <p className="text-ink-muted" style={{ fontSize: 10, marginTop: 4 }}>
          {help}
        </p>
      )}
    </div>
  );
}

// Practice Valuation page — three-model engine + Sale Planner.
export default function ValuationScreen() {
  // Real base (TTM revenue + reported EBITDA) from the baseline-derived
  // finance-series. The interactive engine below stays client-side; this only
  // feeds it real numbers. No baseline → zeros + a banner (degraded fallback).
  const { data: baseData, isLoading: baseLoading } = useValuationBase();
  const baseMissing = !!baseData?.error;
  const base = useMemo(
    () => ({
      ttmRevenue: baseData?.error ? 0 : baseData?.ttmRevenue ?? 0,
      reportedEbitda: baseData?.error ? 0 : baseData?.reportedEbitda ?? 0,
    }),
    [baseData],
  );
  const [tab, setTab] = useState<'current' | 'planner'>('current');
  const [state, setState] = useState<ValuationState>(() => defaultValuationState());

  // Patch helper for the valuation input state.
  const patch = (p: Partial<ValuationState>) => setState((s) => ({ ...s, ...p }));

  // Run the three-model engine whenever inputs change.
  const result = useMemo(() => calculateValuation(state, base), [state, base]);

  // Auto-classify practice type from the NHS % slider (prototype updateValuation).
  const derivedType: PracticeType =
    state.nhsPercent >= 80 ? 'nhs' : state.nhsPercent <= 20 ? 'private' : 'mixed';
  const benchmarks = PRACTICE_TYPE_MULTIPLES[derivedType];
  const dsoBench = benchmarks.dso * (DSO_TIER_MULTIPLIERS[state.dsoTier]?.factor ?? 1.0);
  const regionLabel = REGION_ADJUSTMENTS[state.region]?.label ?? 'Baseline';
  const growthLabel =
    (state.growthRate >= 10 ? '+' : '') + ((result.growthAdjust - 1) * 100).toFixed(0) + '%';

  // Set the practice type from a classification button (prototype setPracticeType).
  function setPracticeType(type: PracticeType) {
    const d = getDefaultMultiples(type, state.dsoTier);
    patch({
      practiceType: type,
      associateMultiple: d.associate,
      principalMultiple: d.principal,
      dsoMultiple: d.dso,
      nhsPercent: type === 'nhs' ? 90 : type === 'mixed' ? 40 : 10,
    });
  }

  // Set the DSO tier and re-derive the DSO multiple (prototype setDsoTier).
  function setDsoTier(tier: DsoTier) {
    const d = getDefaultMultiples(derivedType, tier);
    patch({ dsoTier: tier, dsoMultiple: d.dso });
  }

  // Reset all inputs to industry defaults (prototype resetValuation).
  function reset() {
    setState(defaultValuationState());
  }

  // Value uplift levers, ranked by midpoint impact (prototype updateValuation levers).
  const avgMultiple =
    (state.principalMultiple + state.associateMultiple + state.dsoMultiple) / 3;
  const levers = [
    { label: 'Increase growth rate to 15% (DSO buyers love this)', impact: result.dsoValuation * 0.1 },
    { label: 'Cut lab cost from 18% to 15% target (+£50k EBITDA)', impact: 50000 * avgMultiple },
    { label: 'Identify £30k more legitimate add-backs', impact: 30000 * avgMultiple },
    { label: 'Add second site (scale into DSO interest zone)', impact: result.dsoValuation * 0.15 },
    { label: 'Shift to private/mixed (+0.5x multiple)', impact: 0.5 * result.associateEbitda },
    { label: 'Add £100k recurring private revenue at 35% margin', impact: 35000 * avgMultiple },
  ].sort((a, b) => b.impact - a.impact);

  return (
    <div className="container max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-4">
        <div className="flex justify-between items-end gap-4 flex-wrap">
          <div>
            <h1 className="display text-3xl font-bold">Practice Valuation</h1>
            <p className="text-sm text-ink-muted">
              Three-model valuation: Principal-led · Associate-led · DSO/Corporate
            </p>
          </div>
          <div
            style={{
              background: 'var(--brand-50)',
              border: '1px solid var(--brand-50)',
              padding: '8px 14px',
              borderRadius: 8,
              fontSize: 11,
              color: 'var(--brand)',
              maxWidth: 360,
            }}
          >
            <strong>Sources:</strong> Dental Elite Goodwill Report 2024-25 · Christie &amp; Co
            Market Review 2025 · MyDentist/Bridgepoint deal (July 2025, 10x EBITDA)
          </div>
        </div>
      </div>

      {baseMissing && !baseLoading && (
        <div className="card-padded mb-4" style={{ borderLeft: '4px solid #F59E0B' }}>
          <div className="font-semibold">No baseline — valuation base is £0</div>
          <div className="text-sm text-ink-muted">
            TTM revenue + EBITDA come from your Business Health baseline.
            Complete setup to populate the engine; the inputs below still work
            as a what-if model.
          </div>
        </div>
      )}

      {/* Tab switcher */}
      <div
        className="flex gap-1 mb-4"
        style={{ borderBottom: '2px solid var(--border)' }}
      >
        {(['current', 'planner'] as const).map((t) => {
          const active = tab === t;
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: '12px 20px',
                background: active ? 'rgba(14,124,123,0.05)' : 'transparent',
                border: 'none',
                borderBottom: `3px solid ${active ? BRAND : 'transparent'}`,
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
                color: active ? BRAND : 'var(--ink-muted)',
                marginBottom: -2,
              }}
            >
              {t === 'current' ? 'Current Valuation' : 'Sale Planner'}
            </button>
          );
        })}
        <div style={{ flex: 1 }} />
        <div
          className="flex items-center text-ink-muted"
          style={{ fontSize: 11, padding: '0 8px' }}
        >
          {tab === 'planner'
            ? 'Model your exit · adjust EBITDA and see what hits the target'
            : 'Live snapshot of where you stand today'}
        </div>
      </div>

      {tab === 'current' ? (
        <CurrentTab
          state={state}
          patch={patch}
          base={base}
          result={result}
          derivedType={derivedType}
          benchmarks={benchmarks}
          dsoBench={dsoBench}
          regionLabel={regionLabel}
          growthLabel={growthLabel}
          levers={levers}
          setPracticeType={setPracticeType}
          setDsoTier={setDsoTier}
          reset={reset}
        />
      ) : (
        <PlannerTab base={base} state={state} result={result} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CURRENT VALUATION TAB
// ---------------------------------------------------------------------------
function CurrentTab({
  state,
  patch,
  base,
  result,
  derivedType,
  benchmarks,
  dsoBench,
  regionLabel,
  growthLabel,
  levers,
  setPracticeType,
  setDsoTier,
  reset,
}: {
  state: ValuationState;
  patch: (p: Partial<ValuationState>) => void;
  base: { ttmRevenue: number; reportedEbitda: number };
  result: ReturnType<typeof calculateValuation>;
  derivedType: PracticeType;
  benchmarks: (typeof PRACTICE_TYPE_MULTIPLES)[PracticeType];
  dsoBench: number;
  regionLabel: string;
  growthLabel: string;
  levers: { label: string; impact: number }[];
  setPracticeType: (t: PracticeType) => void;
  setDsoTier: (t: DsoTier) => void;
  reset: () => void;
}) {
  const pctTurnover = (v: number) => ((v / base.ttmRevenue) * 100).toFixed(0) + '%';

  return (
    <div>
      {/* Three-model headline */}
      <div
        className="card-padded mb-4"
        style={{
          background: 'linear-gradient(135deg, #0E7C7B 0%, #085857 100%)',
          color: 'white',
          border: 'none',
        }}
      >
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          {[
            {
              label: 'Principal-led',
              sub: 'Independent dentist buyer · ANP × multiple',
              value: poundsCompact(result.principalValuation),
              detail: `${poundsCompact(result.principalNetProfit)} × ${state.principalMultiple.toFixed(2)}x`,
              colour: 'white',
              border: false,
            },
            {
              label: 'Associate-led',
              sub: 'Small group / micro-consolidator · EBITDA × multiple',
              value: poundsCompact(result.associateValuation),
              detail: `${poundsCompact(result.associateEbitda)} × ${state.associateMultiple.toFixed(2)}x`,
              colour: 'white',
              border: true,
            },
            {
              label: 'DSO / Corporate',
              sub: 'PE / corporate consolidator · EBITDA × premium multiple',
              value: poundsCompact(result.dsoValuation),
              detail: `${poundsCompact(result.associateEbitda)} × ${state.dsoMultiple.toFixed(2)}x × growth`,
              colour: '#FFB547',
              border: false,
            },
          ].map((c) => (
            <div
              key={c.label}
              style={{
                textAlign: 'center',
                padding: '0 12px',
                borderLeft: c.border ? '1px solid rgba(255,255,255,0.15)' : undefined,
                borderRight: c.border ? '1px solid rgba(255,255,255,0.15)' : undefined,
                position: 'relative',
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  opacity: 0.7,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                {c.label}
              </div>
              <div style={{ fontSize: 9, opacity: 0.5, marginBottom: 10 }}>{c.sub}</div>
              <div
                className="display"
                style={{ fontSize: 32, fontWeight: 700, lineHeight: 1, color: c.colour }}
              >
                {c.value}
              </div>
              <div style={{ marginTop: 6, fontSize: 11, opacity: 0.8 }}>{c.detail}</div>
              {c.label === 'DSO / Corporate' && (
                <span
                  style={{
                    position: 'absolute',
                    top: -8,
                    right: 0,
                    background: '#FFB547',
                    color: '#78350F',
                    fontSize: 9,
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: 4,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                  }}
                >
                  Premium
                </span>
              )}
            </div>
          ))}
        </div>
        <div
          className="grid gap-4"
          style={{
            marginTop: 20,
            paddingTop: 16,
            borderTop: '1px solid rgba(255,255,255,0.15)',
            gridTemplateColumns: '1fr 1fr',
          }}
        >
          <div style={{ textAlign: 'center' }}>
            <div
              style={{ fontSize: 10, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.05em' }}
            >
              Most likely sale price
            </div>
            <div className="display" style={{ fontSize: 26, fontWeight: 700, marginTop: 4 }}>
              {poundsCompact(result.midpoint)}
            </div>
            <div style={{ fontSize: 10, opacity: 0.7 }}>Mid of Principal &amp; Associate methods</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div
              style={{ fontSize: 10, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.05em' }}
            >
              Strategic max (DSO + earn-out)
            </div>
            <div
              className="display"
              style={{ fontSize: 26, fontWeight: 700, color: '#FFB547', marginTop: 4 }}
            >
              {poundsCompact(result.strategic)}
            </div>
            <div style={{ fontSize: 10, opacity: 0.7 }}>
              If corporate buyer interested · platform premium
            </div>
          </div>
        </div>
      </div>

      {/* Classification + DSO tier */}
      <div
        className="grid gap-4 mb-4"
        style={{ gridTemplateColumns: '1.5fr 1fr' }}
      >
        <div className="card-padded">
          <h2 className="display text-base font-semibold mb-1">Practice classification</h2>
          <p className="text-ink-muted mb-3" style={{ fontSize: 11 }}>
            Per Dental Elite: &gt;80% NHS = NHS · &gt;80% private = Private · in between = Mixed
          </p>
          <div className="grid gap-2" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
            {(
              [
                { t: 'nhs' as const, name: 'NHS', sub: '>80% NHS' },
                { t: 'mixed' as const, name: 'Mixed', sub: '20-80% NHS' },
                { t: 'private' as const, name: 'Private', sub: '>80% private' },
              ]
            ).map(({ t, name, sub }) => {
              const m = PRACTICE_TYPE_MULTIPLES[t];
              const active = derivedType === t;
              return (
                <button
                  key={t}
                  onClick={() => setPracticeType(t)}
                  style={{
                    textAlign: 'left',
                    padding: 12,
                    borderRadius: 8,
                    border: `1px solid ${active ? BRAND : 'var(--border)'}`,
                    background: active ? 'var(--brand-50)' : 'white',
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{name}</div>
                  <div className="text-ink-muted" style={{ fontSize: 10, marginTop: 2 }}>
                    {sub}
                  </div>
                  <div
                    style={{
                      fontSize: 9,
                      marginTop: 6,
                      paddingTop: 6,
                      borderTop: '1px solid rgba(0,0,0,0.08)',
                      lineHeight: 1.5,
                    }}
                  >
                    Assoc <strong>{m.associate.toFixed(1)}x</strong> · Princ{' '}
                    <strong>{m.principal.toFixed(1)}x</strong> · DSO{' '}
                    <strong>{m.dso.toFixed(1)}x</strong>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="card-padded">
          <h2 className="display text-base font-semibold mb-1">DSO tier</h2>
          <p className="text-ink-muted mb-3" style={{ fontSize: 11 }}>
            Based on site count and EBITDA scale
          </p>
          <select
            value={state.dsoTier}
            onChange={(e) => setDsoTier(e.target.value as DsoTier)}
            style={{
              fontSize: 13,
              width: '100%',
              padding: '8px 10px',
              border: '1px solid var(--border)',
              borderRadius: 6,
            }}
          >
            <option value="bolt_on">Bolt-on (1-9 sites) — 5-7x</option>
            <option value="small_group">Small group (10-30 sites) — 7-8x</option>
            <option value="mid_platform">Mid platform (30-100 sites) — 8-10x</option>
            <option value="large_platform">Large platform (100+ sites) — 10-12x</option>
          </select>
          <div
            className="text-ink-muted"
            style={{ fontSize: 11, marginTop: 8, lineHeight: 1.5 }}
          >
            {DSO_TIER_INFO[state.dsoTier]}
          </div>
        </div>
      </div>

      {/* EBITDA build-up + multiples */}
      <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="card-padded">
          <h2 className="display text-base font-semibold mb-1">EBITDA build-up</h2>
          <p className="text-ink-muted mb-4" style={{ fontSize: 11 }}>
            From accounts to normalised earnings power
          </p>

          <div style={{ marginBottom: 16 }}>
            <div className="flex justify-between" style={{ marginBottom: 6 }}>
              <label className="text-ink-muted" style={{ fontSize: 12, fontWeight: 600 }}>
                Reported EBITDA (TTM)
              </label>
              <span className="font-semibold" style={{ fontSize: 13 }}>
                {poundsCompact(base.reportedEbitda)}
              </span>
            </div>
            <div className="bg-bg" style={{ height: 8, borderRadius: 4 }}>
              <div style={{ height: '100%', background: BRAND, width: '100%', borderRadius: 4 }} />
            </div>
            <p className="text-ink-muted" style={{ fontSize: 10, marginTop: 4 }}>
              Live from your P&amp;L · trailing 12 months
            </p>
          </div>

          <SliderRow
            label="Add-backs"
            value={poundsCompact(state.addBacks)}
            min={0}
            max={300000}
            step={5000}
            onChange={(n) => patch({ addBacks: n })}
            help="One-offs, spouse salary, owner perks, non-recurring legal/professional fees"
          />
          <SliderRow
            label="Principal clinical salary (notional)"
            value={poundsCompact(state.principalSalary)}
            min={0}
            max={300000}
            step={5000}
            onChange={(n) => patch({ principalSalary: n })}
            help="What you pay yourself · Added in Associate/DSO methods · Subtracted in Principal-led"
          />

          <div
            style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)', fontSize: 12 }}
          >
            <div className="flex justify-between" style={{ padding: '3px 0' }}>
              <span className="text-ink-muted">Reported EBITDA</span>
              <span style={{ fontWeight: 500 }}>{poundsCompact(base.reportedEbitda)}</span>
            </div>
            <div className="flex justify-between" style={{ padding: '3px 0' }}>
              <span className="text-ink-muted">+ Add-backs</span>
              <span style={{ color: SUCCESS, fontWeight: 500 }}>
                +{poundsCompact(state.addBacks)}
              </span>
            </div>
            <div className="flex justify-between" style={{ padding: '3px 0' }}>
              <span className="text-ink-muted">+ Principal salary add-back</span>
              <span style={{ color: SUCCESS, fontWeight: 500 }}>
                +{poundsCompact(state.principalSalary)}
              </span>
            </div>
            <div
              className="flex justify-between items-center"
              style={{ padding: '10px 0 4px', borderTop: '1px solid var(--border)', marginTop: 6 }}
            >
              <strong style={{ fontSize: 12 }}>Adjusted EBITDA</strong>
              <span
                className="display"
                style={{ fontSize: 18, fontWeight: 600, color: 'var(--brand)' }}
              >
                {poundsCompact(result.associateEbitda)}
              </span>
            </div>
            <div
              className="flex justify-between items-center"
              style={{ padding: '10px 0 4px', borderTop: '1px solid var(--border)', marginTop: 6 }}
            >
              <strong style={{ fontSize: 12 }}>Adjusted Net Profit (Principal-led)</strong>
              <span
                className="display"
                style={{ fontSize: 18, fontWeight: 600, color: 'var(--accent)' }}
              >
                {poundsCompact(result.principalNetProfit)}
              </span>
            </div>
            <div className="text-ink-muted" style={{ fontSize: 10, marginTop: 6 }}>
              ANP = Reported EBITDA + Add-backs (principal clinical work funded from this)
            </div>
          </div>
        </div>

        <div className="card-padded">
          <h2 className="display text-base font-semibold mb-1">Multiples</h2>
          <p className="text-ink-muted mb-4" style={{ fontSize: 11 }}>
            Industry averages auto-set when you change practice type
          </p>

          <SliderRow
            label="Principal-led multiple (ANP)"
            value={state.principalMultiple.toFixed(2) + 'x'}
            min={2}
            max={5}
            step={0.05}
            onChange={(n) => patch({ principalMultiple: n })}
            help={
              <>
                {derivedType.toUpperCase()} avg:{' '}
                <strong>{benchmarks.principal.toFixed(2)}x</strong> · You:{' '}
                {variance(state.principalMultiple, benchmarks.principal, 'x')}
              </>
            }
          />
          <SliderRow
            label="Associate-led multiple (EBITDA)"
            value={state.associateMultiple.toFixed(2) + 'x'}
            min={4}
            max={9}
            step={0.05}
            onChange={(n) => patch({ associateMultiple: n })}
            help={
              <>
                {derivedType.toUpperCase()} avg:{' '}
                <strong>{benchmarks.associate.toFixed(2)}x</strong> · You:{' '}
                {variance(state.associateMultiple, benchmarks.associate, 'x')}
              </>
            }
          />
          <SliderRow
            label="DSO multiple (EBITDA)"
            value={state.dsoMultiple.toFixed(2) + 'x'}
            min={4}
            max={14}
            step={0.1}
            onChange={(n) => patch({ dsoMultiple: n })}
            help={
              <>
                {DSO_TIER_MULTIPLIERS[state.dsoTier].label} avg:{' '}
                <strong>{dsoBench.toFixed(2)}x</strong> · You:{' '}
                {variance(state.dsoMultiple, dsoBench, 'x')}
              </>
            }
          />
          <SliderRow
            label="Practice growth rate (YoY)"
            value={state.growthRate + '%'}
            min={-10}
            max={30}
            step={1}
            onChange={(n) => patch({ growthRate: n })}
            help="DSO buyers pay premium for 10%+ growth · MyDentist sold at 24% private growth"
          />
          <SliderRow
            label="NHS revenue %"
            value={state.nhsPercent + '%'}
            min={0}
            max={100}
            step={5}
            onChange={(n) => patch({ nhsPercent: n })}
            help="Auto-classifies practice type · affects multiples"
          />

          <div style={{ marginBottom: 16 }}>
            <div className="flex justify-between" style={{ marginBottom: 6 }}>
              <label className="text-ink-muted" style={{ fontSize: 12, fontWeight: 600 }}>
                Region
              </label>
              <span className="font-semibold" style={{ fontSize: 13 }}>
                {REGIONS_DISPLAY[state.region]}
              </span>
            </div>
            <select
              value={state.region}
              onChange={(e) => patch({ region: e.target.value as RegionKey })}
              style={{
                width: '100%',
                padding: '8px 10px',
                border: '1px solid var(--border)',
                borderRadius: 6,
                fontSize: 13,
              }}
            >
              <option value="london">London (+7.5%)</option>
              <option value="south_east">South East (+5%)</option>
              <option value="midlands">Midlands (baseline)</option>
              <option value="wales">Wales (baseline)</option>
              <option value="south_west">South West (-3%)</option>
              <option value="north">North England (-5%)</option>
              <option value="scotland">Scotland (-3%)</option>
              <option value="ni">N. Ireland (-5%)</option>
            </select>
          </div>

          <div
            className="flex gap-2"
            style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)' }}
          >
            <button
              onClick={reset}
              className="btn-ghost"
              style={{ flex: 1, border: '1px solid var(--border)', borderRadius: 6, padding: '8px 0' }}
            >
              Reset
            </button>
          </div>
        </div>
      </div>

      {/* Detailed breakdown */}
      <div className="card-padded mb-4">
        <h2 className="display text-base font-semibold mb-4">Detailed breakdown</h2>
        <table className="w-full" style={{ fontSize: 13, margin: '-16px 0 0' }}>
          <thead>
            <tr className="text-ink-muted" style={{ textAlign: 'left' }}>
              <th style={{ padding: '10px 8px' }}>Method</th>
              <th className="text-right" style={{ padding: '10px 8px' }}>Base</th>
              <th className="text-right" style={{ padding: '10px 8px' }}>Multiple</th>
              <th className="text-right" style={{ padding: '10px 8px' }}>Region</th>
              <th className="text-right" style={{ padding: '10px 8px' }}>Growth adj.</th>
              <th className="text-right" style={{ padding: '10px 8px' }}>Valuation</th>
              <th className="text-right" style={{ padding: '10px 8px' }}>% turnover</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderTop: '1px solid var(--border)' }}>
              <td style={{ padding: '10px 8px' }}>
                <strong>Principal-led</strong>
                <br />
                <span className="text-ink-muted" style={{ fontSize: 10 }}>
                  ANP × multiple
                </span>
              </td>
              <td className="text-right" style={{ padding: '10px 8px' }}>
                {poundsCompact(result.principalNetProfit)}
              </td>
              <td className="text-right" style={{ padding: '10px 8px' }}>
                {state.principalMultiple.toFixed(2)}x
              </td>
              <td className="text-right" style={{ padding: '10px 8px' }}>
                {regionLabel}
              </td>
              <td className="text-right text-ink-muted" style={{ padding: '10px 8px' }}>
                n/a
              </td>
              <td
                className="text-right"
                style={{ padding: '10px 8px', fontWeight: 700, fontSize: 15, color: 'var(--brand)' }}
              >
                {poundsCompact(result.principalValuation)}
              </td>
              <td className="text-right" style={{ padding: '10px 8px' }}>
                {pctTurnover(result.principalValuation)}
              </td>
            </tr>
            <tr style={{ borderTop: '1px solid var(--border)' }}>
              <td style={{ padding: '10px 8px' }}>
                <strong>Associate-led</strong>
                <br />
                <span className="text-ink-muted" style={{ fontSize: 10 }}>
                  Adj EBITDA × multiple
                </span>
              </td>
              <td className="text-right" style={{ padding: '10px 8px' }}>
                {poundsCompact(result.associateEbitda)}
              </td>
              <td className="text-right" style={{ padding: '10px 8px' }}>
                {state.associateMultiple.toFixed(2)}x
              </td>
              <td className="text-right" style={{ padding: '10px 8px' }}>
                {regionLabel}
              </td>
              <td className="text-right text-ink-muted" style={{ padding: '10px 8px' }}>
                n/a
              </td>
              <td
                className="text-right"
                style={{ padding: '10px 8px', fontWeight: 700, fontSize: 15, color: 'var(--brand)' }}
              >
                {poundsCompact(result.associateValuation)}
              </td>
              <td className="text-right" style={{ padding: '10px 8px' }}>
                {pctTurnover(result.associateValuation)}
              </td>
            </tr>
            <tr style={{ background: 'rgba(255,181,71,0.08)' }}>
              <td style={{ padding: '10px 8px' }}>
                <strong>DSO / Corporate</strong>
                <br />
                <span className="text-ink-muted" style={{ fontSize: 10 }}>
                  Adj EBITDA × premium × growth
                </span>
              </td>
              <td className="text-right" style={{ padding: '10px 8px' }}>
                {poundsCompact(result.associateEbitda)}
              </td>
              <td className="text-right" style={{ padding: '10px 8px' }}>
                {state.dsoMultiple.toFixed(2)}x
              </td>
              <td className="text-right" style={{ padding: '10px 8px' }}>
                {regionLabel}
              </td>
              <td className="text-right" style={{ padding: '10px 8px' }}>
                {growthLabel}
              </td>
              <td
                className="text-right"
                style={{ padding: '10px 8px', fontWeight: 700, fontSize: 15, color: '#B45309' }}
              >
                {poundsCompact(result.dsoValuation)}
              </td>
              <td className="text-right" style={{ padding: '10px 8px' }}>
                {pctTurnover(result.dsoValuation)}
              </td>
            </tr>
            <tr style={{ background: '#FEF3C7' }}>
              <td style={{ padding: '10px 8px' }}>
                <strong>Midpoint (most likely)</strong>
              </td>
              <td colSpan={4} />
              <td
                className="text-right display"
                style={{ padding: '10px 8px', fontSize: 18, fontWeight: 700, color: '#78350F' }}
              >
                {poundsCompact(result.midpoint)}
              </td>
              <td className="text-right" style={{ padding: '10px 8px', fontWeight: 600 }}>
                {pctTurnover(result.midpoint)}
              </td>
            </tr>
            <tr style={{ background: 'rgba(255,181,71,0.15)' }}>
              <td style={{ padding: '10px 8px' }}>
                <strong>Strategic max (DSO + earn-out)</strong>
              </td>
              <td colSpan={4} />
              <td
                className="text-right display"
                style={{ padding: '10px 8px', fontSize: 18, fontWeight: 700, color: '#78350F' }}
              >
                {poundsCompact(result.strategic)}
              </td>
              <td className="text-right" style={{ padding: '10px 8px', fontWeight: 600 }}>
                {pctTurnover(result.strategic)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* DSO buyer landscape */}
      <div className="card-padded mb-4">
        <h2 className="display text-base font-semibold mb-1">UK DSO buyer landscape (2025)</h2>
        <p className="text-ink-muted mb-4" style={{ fontSize: 11 }}>
          Top 4 corporate buyers and their typical bolt-on profile
        </p>
        <table className="w-full" style={{ fontSize: 13, margin: '-16px 0 0' }}>
          <thead>
            <tr className="text-ink-muted" style={{ textAlign: 'left' }}>
              <th style={{ padding: '10px 8px' }}>Buyer</th>
              <th className="text-right" style={{ padding: '10px 8px' }}>Practices owned</th>
              <th style={{ padding: '10px 8px' }}>Owner</th>
              <th style={{ padding: '10px 8px' }}>Strategy</th>
              <th className="text-right" style={{ padding: '10px 8px' }}>
                Typical multiple paid
              </th>
            </tr>
          </thead>
          <tbody>
            {[
              ['MyDentist', '~600 (largest)', 'Bridgepoint PE', 'NHS-led, expanding private mix', '5-7x bolt-on · sold July 2025 at 10x (£800M)'],
              ['Bupa Dental', '~380', 'Bupa (insurance)', 'Private-leaning, premium areas', '6-8x bolt-on'],
              ['PortmanDentex', '~376', 'Core Equity Holdings', 'Mixed/private, mid-market', '6-8x bolt-on'],
              ['Rodericks Dental Partners', '~226', 'CapVest PE', 'Merged with Dental Partners 2024', '5-7x bolt-on'],
            ].map((r) => (
              <tr key={r[0]} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '10px 8px' }}>
                  <strong>{r[0]}</strong>
                </td>
                <td className="text-right" style={{ padding: '10px 8px' }}>
                  {r[1]}
                </td>
                <td style={{ padding: '10px 8px' }}>{r[2]}</td>
                <td style={{ padding: '10px 8px' }}>{r[3]}</td>
                <td className="text-right" style={{ padding: '10px 8px' }}>
                  {r[4]}
                </td>
              </tr>
            ))}
            <tr className="bg-bg">
              <td colSpan={5} className="text-ink-muted" style={{ fontSize: 11, padding: '10px 8px' }}>
                <strong>Minimum DSO interest threshold:</strong> typically 5+ surgeries, &gt;£800k
                turnover, EBITDA margin &gt;12%, growth potential clearly demonstrable
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Benchmarks vs you */}
      <div className="card-padded mb-4">
        <h2 className="display text-base font-semibold mb-4">Industry benchmarks vs you</h2>
        <table className="w-full" style={{ fontSize: 13, margin: '-16px 0 0' }}>
          <thead>
            <tr className="text-ink-muted" style={{ textAlign: 'left' }}>
              <th style={{ padding: '10px 8px' }}>Metric</th>
              <th className="text-right" style={{ padding: '10px 8px' }}>UK industry avg</th>
              <th className="text-right" style={{ padding: '10px 8px' }}>Your practice</th>
              <th className="text-right" style={{ padding: '10px 8px' }}>Variance</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderTop: '1px solid var(--border)' }}>
              <td style={{ padding: '10px 8px' }}>Principal-led ANP multiple</td>
              <td className="text-right" style={{ padding: '10px 8px' }}>
                {benchmarks.principal.toFixed(2)}x{' '}
                <span className="text-ink-muted" style={{ fontSize: 11 }}>
                  ({derivedType})
                </span>
              </td>
              <td className="text-right" style={{ padding: '10px 8px' }}>
                {state.principalMultiple.toFixed(2)}x
              </td>
              <td className="text-right" style={{ padding: '10px 8px' }}>
                {variance(state.principalMultiple, benchmarks.principal, 'x')}
              </td>
            </tr>
            <tr style={{ borderTop: '1px solid var(--border)' }}>
              <td style={{ padding: '10px 8px' }}>Associate-led EBITDA multiple</td>
              <td className="text-right" style={{ padding: '10px 8px' }}>
                {benchmarks.associate.toFixed(2)}x
              </td>
              <td className="text-right" style={{ padding: '10px 8px' }}>
                {state.associateMultiple.toFixed(2)}x
              </td>
              <td className="text-right" style={{ padding: '10px 8px' }}>
                {variance(state.associateMultiple, benchmarks.associate, 'x')}
              </td>
            </tr>
            <tr style={{ borderTop: '1px solid var(--border)' }}>
              <td style={{ padding: '10px 8px' }}>
                DSO multiple ({DSO_TIER_MULTIPLIERS[state.dsoTier].label})
              </td>
              <td className="text-right" style={{ padding: '10px 8px' }}>
                {dsoBench.toFixed(2)}x{' '}
                <span className="text-ink-muted" style={{ fontSize: 11 }}>
                  {DSO_TIER_MULTIPLIERS[state.dsoTier].range}
                </span>
              </td>
              <td className="text-right" style={{ padding: '10px 8px' }}>
                {state.dsoMultiple.toFixed(2)}x
              </td>
              <td className="text-right" style={{ padding: '10px 8px' }}>
                {variance(state.dsoMultiple, dsoBench, 'x')}
              </td>
            </tr>
            <tr style={{ borderTop: '1px solid var(--border)' }}>
              <td style={{ padding: '10px 8px' }}>Sale price as % of turnover</td>
              <td className="text-right" style={{ padding: '10px 8px' }}>
                {(benchmarks.percTurnover * 100).toFixed(0)}%
              </td>
              <td className="text-right" style={{ padding: '10px 8px' }}>
                {((result.midpoint / base.ttmRevenue) * 100).toFixed(0)}%
              </td>
              <td className="text-right" style={{ padding: '10px 8px' }}>
                {variance(
                  (result.midpoint / base.ttmRevenue) * 100,
                  benchmarks.percTurnover * 100,
                  'pp',
                )}
              </td>
            </tr>
            <tr style={{ borderTop: '1px solid var(--border)' }}>
              <td style={{ padding: '10px 8px' }}>Avg sale price ({derivedType})</td>
              <td className="text-right" style={{ padding: '10px 8px' }}>
                {poundsCompact(benchmarks.avgSale)}
              </td>
              <td className="text-right" style={{ padding: '10px 8px', fontWeight: 600 }}>
                {poundsCompact(result.midpoint)}
              </td>
              <td className="text-right" style={{ padding: '10px 8px' }}>
                {priceVariance(result.midpoint, benchmarks.avgSale)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Value uplift levers */}
      <div className="card-padded mb-4">
        <h2 className="display text-base font-semibold mb-1">Value uplift levers</h2>
        <p className="text-ink-muted mb-3" style={{ fontSize: 11 }}>
          Ranked by impact on midpoint valuation
        </p>
        <div>
          {levers.map((l) => (
            <div
              key={l.label}
              className="flex justify-between items-center"
              style={{ padding: '8px 0', borderTop: '1px solid var(--border)' }}
            >
              <span style={{ fontSize: 13 }}>{l.label}</span>
              <span style={{ color: SUCCESS, fontSize: 15, fontWeight: 600 }}>
                +{poundsCompact(l.impact)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Methodology */}
      <div className="card-padded" style={{ background: '#FFFBEB', borderColor: '#FDE68A' }}>
        <h3
          className="display"
          style={{ fontSize: 14, fontWeight: 600, marginBottom: 10, color: '#78350F' }}
        >
          Why three valuation models?
        </h3>
        <div style={{ fontSize: 12, color: '#78350F', lineHeight: 1.7 }}>
          <p style={{ marginBottom: 8 }}>
            <strong>Different buyers value the same practice differently.</strong> Use the model
            that matches your most likely buyer:
          </p>
          <ul style={{ paddingLeft: 20, marginBottom: 10 }}>
            <li>
              <strong>Principal-led (lowest)</strong> — single dentist buyer who will work the
              practice. Subtracts notional principal salary from profit. 2024-25 avg:{' '}
              <strong>3.31x ANP</strong>. ~70% of all UK practice sales.
            </li>
            <li>
              <strong>Associate-led (mid)</strong> — small group or micro-consolidator. Adds
              principal salary back (clinical work covered by associates). 2024-25 avg:{' '}
              <strong>7.16x EBITDA</strong>. ~15% of sales.
            </li>
            <li>
              <strong>DSO/Corporate (highest)</strong> — private equity or major corporate
              (MyDentist, Bupa Dental, PortmanDentex, Rodericks). Higher multiples justified by
              platform arbitrage and operational synergies. 2024-25 range:{' '}
              <strong>5-12x EBITDA</strong> depending on platform scale. ~15% of sales.
            </li>
          </ul>
          <p style={{ marginBottom: 8 }}>
            <strong>2024-25 market reality:</strong>
          </p>
          <ul style={{ paddingLeft: 20 }}>
            <li>2024 saw 9.4% price decline, 2025 stabilising +2.9% — corporates returning</li>
            <li>
              MyDentist sold to Bridgepoint July 2025 at <strong>10x EBITDA</strong> (£800M EV /
              £74M EBITDA, 600 practices)
            </li>
            <li>
              London/SE associate-led max <strong>7.7x</strong> — premium locations command 5-10%
              uplift
            </li>
            <li>
              DSO bolt-on premium narrowing — gap between single sites and group sites is closing
            </li>
            <li>Growth rate &gt;10% YoY = biggest valuation lever for DSO interest</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SALE PLANNER TAB
// ---------------------------------------------------------------------------
interface PlannerState {
  targetValue: number;
  targetYears: number;
  futureEbitda: number;
  futureRevenue: number;
  futureMultiple: number;
  futureBuyerType: 'principal' | 'associate' | 'dso';
  addedSites: number;
}

// Hint text describing where a chosen exit multiple sits vs the market (prototype getMultipleHint).
function multipleHint(mult: number, buyer: PlannerState['futureBuyerType']): string {
  if (buyer === 'principal') {
    if (mult <= 3.0) return 'Below market for principal-led (avg 3.31x ANP)';
    if (mult <= 3.5) return 'Market average for principal-led buyers';
    return 'Premium — requires excellent NHS/private mix + location';
  }
  if (buyer === 'associate') {
    if (mult <= 6.5) return 'Below market (avg 7.16x EBITDA in 2024-25)';
    if (mult <= 7.5) return 'Market average for associate-led / small group';
    return 'Premium — London/SE max is around 7.7x';
  }
  if (mult <= 5.5) return 'DSO bolt-on range — single site / weak systems';
  if (mult <= 7) return 'DSO small group range (10-30 sites)';
  if (mult <= 9) return 'Mid-platform range (30-100 sites)';
  return 'Large platform (100+ sites, MyDentist sold at 10x July 2025)';
}

// Sale Planner: model a target exit and the path to reach it.
function PlannerTab({
  base,
  state,
  result,
}: {
  base: { ttmRevenue: number; reportedEbitda: number };
  state: ValuationState;
  result: ReturnType<typeof calculateValuation>;
}) {
  const [p, setP] = useState<PlannerState>(() => ({
    targetValue: 10000000,
    targetYears: 5,
    futureEbitda: Math.round(base.reportedEbitda * 1.6),
    futureRevenue: Math.round(base.ttmRevenue * 1.5),
    futureMultiple: 7.5,
    futureBuyerType: 'associate',
    addedSites: 0,
  }));
  const patch = (x: Partial<PlannerState>) => setP((s) => ({ ...s, ...x }));

  // Derive projection, gap, CAGR and the year-by-year build plan.
  const calc = useMemo(() => {
    const baseline = result.midpoint;
    let projected =
      p.futureBuyerType === 'principal'
        ? (p.futureEbitda - 120000) * p.futureMultiple
        : p.futureEbitda * p.futureMultiple;
    const totalSites = state.siteCount + p.addedSites;
    if (p.futureBuyerType === 'dso' && totalSites >= 10) projected *= 1.1;

    const gap = Math.max(0, p.targetValue - baseline);
    const cagrNeeded =
      baseline > 0 && p.targetYears > 0
        ? (Math.pow(p.targetValue / baseline, 1 / p.targetYears) - 1) * 100
        : 0;
    const ebitdaNeeded = p.targetValue / p.futureMultiple;
    const ebitdaMargin = p.futureRevenue > 0 ? (p.futureEbitda / p.futureRevenue) * 100 : 0;
    const currentEbitdaMargin =
      base.ttmRevenue > 0 ? (base.reportedEbitda / base.ttmRevenue) * 100 : 0;
    const revenueGrowthPct =
      base.ttmRevenue > 0 ? (p.futureRevenue / base.ttmRevenue - 1) * 100 : 0;

    // Year-by-year linear interpolation from now to target.
    const years = [];
    const endSites = state.siteCount + p.addedSites;
    for (let i = 0; i <= p.targetYears; i++) {
      const t = i / p.targetYears;
      const rev = base.ttmRevenue + (p.futureRevenue - base.ttmRevenue) * t;
      const ebitda = base.reportedEbitda + (p.futureEbitda - base.reportedEbitda) * t;
      const sites = Math.round(state.siteCount + (endSites - state.siteCount) * t);
      const margin = rev > 0 ? (ebitda / rev) * 100 : 0;
      const valYear =
        ebitda * p.futureMultiple * (p.futureBuyerType === 'dso' && sites >= 10 ? 1.1 : 1);
      let focus: string;
      if (i === 0) focus = 'Baseline · clean books, tidy Xero, install KPI scorecard';
      else if (i === 1)
        focus = 'Lift conversion + chair util · launch loyalty plan · first PM hire';
      else if (i === 2)
        focus =
          endSites > state.siteCount
            ? `Acquire site #${state.siteCount + 1} · integrate · stabilise`
            : 'Implant pillar to £200k/month · Practice Freedom Formula';
      else if (i === p.targetYears)
        focus = 'Exit-ready · marketing pack with broker (Dental Elite / Christie & Co) · DD prep';
      else focus = 'Compound: margin discipline · selective acquisitions';
      years.push({ year: i, rev, ebitda, sites, margin, valYear, focus });
    }

    return {
      baseline,
      projected,
      gap,
      cagrNeeded,
      ebitdaNeeded,
      ebitdaMargin,
      currentEbitdaMargin,
      revenueGrowthPct,
      totalSites,
      years,
    };
  }, [p, base, state, result]);

  const onTarget = calc.projected >= p.targetValue;
  const pctOfTarget = (calc.projected / p.targetValue) * 100;

  // Build the ranked "path to target" action cards (prototype buildActionCards).
  const cards: {
    colour: string;
    bg: string;
    title: string;
    headline: string;
    detail: string;
    actions: string[];
  }[] = [];
  const revGap = p.futureRevenue - base.ttmRevenue;
  if (revGap > 0) {
    const yearlyRevGrowth = Math.pow(p.futureRevenue / base.ttmRevenue, 1 / p.targetYears) - 1;
    cards.push({
      colour: '#059669',
      bg: '#D1FAE5',
      title: 'Grow revenue',
      headline: `${formatCurrency(revGap)} more annual revenue`,
      detail: `Compound at ${(yearlyRevGrowth * 100).toFixed(1)}%/year for ${p.targetYears} years to hit ${formatCurrency(p.futureRevenue)}.`,
      actions: [
        revGap > 1000000
          ? 'Implant Master Playbook — target £200k/mo implant pillar'
          : 'Add high-value treatments (implants/Invisalign)',
        'Instagram Authority Sprint to drive lead volume',
        'Hire treatment coordinator(s) to lift conversion 11.5% to 18%+',
      ],
    });
  }
  const marginGap = calc.ebitdaMargin - calc.currentEbitdaMargin;
  if (marginGap > 0.5) {
    cards.push({
      colour: '#0284C7',
      bg: '#DBEAFE',
      title: 'Lift EBITDA margin',
      headline: `${calc.currentEbitdaMargin.toFixed(1)}% to ${calc.ebitdaMargin.toFixed(1)}%`,
      detail: `Top-quartile UK dental sits at 25-30% EBITDA. You're modelling ${calc.ebitdaMargin.toFixed(1)}% which is ${calc.ebitdaMargin >= 25 ? 'top-quartile' : 'in reach with focus on costs'}.`,
      actions: [
        'Associate pay audit — typical leakage is 2-4% of revenue',
        'Lab fee benchmarking — should be <=8% of private revenue',
        'Operational efficiency: chair util > 80%, FTAs < 3%',
      ],
    });
  } else if (marginGap < -0.5) {
    cards.push({
      colour: '#DC2626',
      bg: '#FEE2E2',
      title: 'EBITDA margin compressing',
      headline: `${calc.currentEbitdaMargin.toFixed(1)}% to ${calc.ebitdaMargin.toFixed(1)}%`,
      detail:
        'Your future model has lower margin than today. Either lift the EBITDA slider or accept a lower valuation.',
      actions: ['Re-check your future EBITDA assumption — buyers reward margin discipline'],
    });
  }
  const currentMidMult = (state.principalMultiple + state.associateMultiple) / 2;
  if (p.futureMultiple > currentMidMult + 0.3) {
    cards.push({
      colour: '#7C3AED',
      bg: '#EDE9FE',
      title: 'Justify a higher multiple',
      headline: `${currentMidMult.toFixed(1)}x to ${p.futureMultiple.toFixed(1)}x multiple`,
      detail: `Each +0.5x on your EBITDA = ${formatCurrency(p.futureEbitda * 0.5)} extra at sale. Multiples ladder up by reducing key-person risk and systemising operations.`,
      actions: [
        'Practice Freedom Formula — owner working <=2 days/week clinical',
        'Senior practice manager in place 12+ months before sale',
        '12+ months of clean monthly P&Ls + Xero-tidy books',
      ],
    });
  }
  if (p.addedSites > 0) {
    cards.push({
      colour: '#EA580C',
      bg: '#FED7AA',
      title: 'Scale the group',
      headline: `+${p.addedSites} sites · total ${calc.totalSites}`,
      detail: `At ${calc.totalSites} sites you ${calc.totalSites >= 10 ? 'cross into small-group DSO territory (10+ sites) — +5% multiplier kicks in.' : 'remain in bolt-on territory. Get to 10+ for the small-group premium.'}`,
      actions: [
        'Multi-Practice Group Building module — acquisition target sourcing',
        'Funding plan: bank financing, MBO structure, or JV',
        'Day-1 integration playbook ready before each deal closes',
      ],
    });
  }
  if (p.futureBuyerType === 'dso') {
    cards.push({
      colour: '#DB2777',
      bg: '#FCE7F3',
      title: 'YoY growth rate matters most for DSOs',
      headline: 'Show 10%+ YoY for 3 consecutive years',
      detail:
        'DSO buyers pay premium for growth trajectory, not just absolute EBITDA. Below 5% YoY = bolt-on price. Above 15% YoY = scarce, mid-platform multiples available.',
      actions: [
        'Monthly board pack showing YoY revenue + EBITDA growth',
        'Set quarterly KPI targets and hit them publicly with the team',
      ],
    });
  }
  if (cards.length === 0) {
    cards.push({
      colour: '#10B981',
      bg: '#D1FAE5',
      title: 'On track',
      headline: 'Your model already hits the target',
      detail:
        'Maintain discipline on EBITDA margin and YoY growth. Make sure books are buyer-ready 18 months before exit.',
      actions: [
        'Run the Practice Freedom Formula audit',
        'Tidy Xero — every transaction categorised',
      ],
    });
  }

  return (
    <div>
      {/* Target vs current headline */}
      <div
        className="card-padded mb-4"
        style={{
          background: 'linear-gradient(135deg, #7C3AED 0%, #5B21B6 100%)',
          color: 'white',
          border: 'none',
        }}
      >
        <div
          className="grid items-center gap-4"
          style={{ gridTemplateColumns: '1fr 60px 1fr' }}
        >
          <div style={{ textAlign: 'center' }}>
            <div
              style={{ fontSize: 10, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.05em' }}
            >
              Today&apos;s midpoint
            </div>
            <div className="display" style={{ fontSize: 32, fontWeight: 600, marginTop: 4 }}>
              {formatCurrency(calc.baseline)}
            </div>
            <div style={{ fontSize: 11, opacity: 0.85, marginTop: 6 }}>
              Based on £{(base.reportedEbitda / 1000).toFixed(0)}k EBITDA
            </div>
          </div>
          <div style={{ textAlign: 'center', fontSize: 28, opacity: 0.5 }}>→</div>
          <div style={{ textAlign: 'center' }}>
            <div
              style={{ fontSize: 10, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.05em' }}
            >
              Target sale value
            </div>
            <div className="display" style={{ fontSize: 32, fontWeight: 600, marginTop: 4 }}>
              {formatCurrency(p.targetValue)}
            </div>
            <div style={{ fontSize: 11, opacity: 0.85, marginTop: 6 }}>
              In {p.targetYears} years
            </div>
          </div>
        </div>
        <div
          className="grid gap-3"
          style={{
            marginTop: 18,
            paddingTop: 14,
            borderTop: '1px solid rgba(255,255,255,0.15)',
            gridTemplateColumns: 'repeat(3, 1fr)',
            textAlign: 'center',
          }}
        >
          <div>
            <div
              style={{ fontSize: 10, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.05em' }}
            >
              Gap to close
            </div>
            <div className="display" style={{ fontSize: 18, fontWeight: 600, marginTop: 2 }}>
              {formatCurrency(calc.gap)}
            </div>
          </div>
          <div>
            <div
              style={{ fontSize: 10, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.05em' }}
            >
              Required CAGR
            </div>
            <div className="display" style={{ fontSize: 18, fontWeight: 600, marginTop: 2 }}>
              {calc.cagrNeeded.toFixed(1)}%/yr
            </div>
          </div>
          <div>
            <div
              style={{ fontSize: 10, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.05em' }}
            >
              EBITDA needed
            </div>
            <div className="display" style={{ fontSize: 18, fontWeight: 600, marginTop: 2 }}>
              {formatCurrency(calc.ebitdaNeeded)}
            </div>
          </div>
        </div>
      </div>

      {/* Modelled future valuation */}
      <div
        className="card-padded mb-4"
        style={{
          background: 'linear-gradient(135deg, #0E7C7B 0%, #085857 100%)',
          color: 'white',
          border: 'none',
        }}
      >
        <div className="flex justify-between items-center" style={{ marginBottom: 10 }}>
          <div>
            <div
              style={{ fontSize: 10, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.05em' }}
            >
              If you hit your model
            </div>
            <div style={{ fontSize: 11, opacity: 0.5, marginTop: 2 }}>
              Projected sale value using inputs below
            </div>
          </div>
          <div
            style={{
              fontSize: 11,
              padding: '4px 10px',
              borderRadius: 14,
              background: onTarget ? '#10B981' : 'rgba(220,38,38,0.85)',
              fontWeight: 700,
            }}
          >
            {onTarget
              ? `${pctOfTarget.toFixed(0)}% of target · +${formatCurrency(calc.projected - p.targetValue)} surplus`
              : `${pctOfTarget.toFixed(0)}% of target · ${formatCurrency(p.targetValue - calc.projected)} short`}
          </div>
        </div>
        <div className="display" style={{ fontSize: 44, fontWeight: 600, lineHeight: 1 }}>
          {formatCurrency(calc.projected)}
        </div>
        <div style={{ fontSize: 12, opacity: 0.85, marginTop: 8 }}>
          £{(p.futureEbitda / 1000).toFixed(0)}k EBITDA × {p.futureMultiple.toFixed(1)}x{' '}
          {p.futureBuyerType === 'dso' && calc.totalSites >= 10 ? '× 1.10 group premium' : ''} ·{' '}
          {p.futureBuyerType} buyer
        </div>
      </div>

      {/* Inputs */}
      <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="card-padded">
          <h3 className="display" style={{ fontSize: 15, fontWeight: 600, marginBottom: 14, color: '#7C3AED' }}>
            Your target
          </h3>
          <SliderRow
            label="Target sale value"
            value={formatCurrency(p.targetValue)}
            min={1000000}
            max={50000000}
            step={500000}
            onChange={(n) => patch({ targetValue: n })}
          />
          <SliderRow
            label="Timeline (years)"
            value={p.targetYears + ' yrs'}
            min={1}
            max={10}
            step={1}
            onChange={(n) => patch({ targetYears: n })}
          />
          <div>
            <label
              className="text-ink-muted"
              style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}
            >
              Most likely buyer type
            </label>
            <select
              value={p.futureBuyerType}
              onChange={(e) =>
                patch({ futureBuyerType: e.target.value as PlannerState['futureBuyerType'] })
              }
              style={{
                marginTop: 4,
                width: '100%',
                padding: '8px 10px',
                border: '1px solid var(--border)',
                borderRadius: 6,
                fontSize: 13,
              }}
            >
              <option value="principal">Principal-led (independent dentist)</option>
              <option value="associate">Associate-led (small group)</option>
              <option value="dso">DSO / Corporate</option>
            </select>
          </div>
        </div>

        <div className="card-padded">
          <h3 className="display" style={{ fontSize: 15, fontWeight: 600, marginBottom: 14, color: '#059669' }}>
            What you&apos;ll change
          </h3>
          <SliderRow
            label="Future annual revenue"
            value={formatCurrency(p.futureRevenue)}
            min={Math.round((base.ttmRevenue * 0.5) / 100000) * 100000}
            max={Math.round((base.ttmRevenue * 3) / 100000) * 100000}
            step={100000}
            onChange={(n) => patch({ futureRevenue: n })}
            help={
              <>
                Currently <strong>{formatCurrency(base.ttmRevenue)}</strong> ·{' '}
                <strong>
                  {(calc.revenueGrowthPct >= 0 ? '+' : '') + calc.revenueGrowthPct.toFixed(0)}%
                </strong>
              </>
            }
          />
          <SliderRow
            label="Future EBITDA"
            value={formatCurrency(p.futureEbitda)}
            min={Math.round((base.reportedEbitda * 0.5) / 10000) * 10000}
            max={Math.round((base.reportedEbitda * 5) / 10000) * 10000}
            step={10000}
            onChange={(n) => patch({ futureEbitda: n })}
            help={
              <>
                Currently <strong>{formatCurrency(base.reportedEbitda)}</strong> ·{' '}
                <strong>{calc.ebitdaMargin.toFixed(1)}%</strong> margin
              </>
            }
          />
          <SliderRow
            label="Expected exit multiple"
            value={p.futureMultiple.toFixed(1) + 'x'}
            min={3}
            max={12}
            step={0.1}
            onChange={(n) => patch({ futureMultiple: n })}
            help={multipleHint(p.futureMultiple, p.futureBuyerType)}
          />
          <SliderRow
            label="Sites added by exit"
            value={'+' + p.addedSites}
            min={0}
            max={15}
            step={1}
            onChange={(n) => patch({ addedSites: n })}
            help={
              <>
                Currently {state.siteCount} sites · Total after:{' '}
                <strong>{calc.totalSites}</strong>
              </>
            }
          />
        </div>
      </div>

      {/* Path to target — action cards */}
      <h2 className="display" style={{ fontSize: 18, fontWeight: 700, margin: '24px 0 10px' }}>
        Your path to {formatCurrency(p.targetValue)}
      </h2>
      <p className="text-ink-muted mb-3" style={{ fontSize: 13 }}>
        These levers compound. Each card shows the gap and how to close it.
      </p>
      <div
        className="grid gap-3 mb-4"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))' }}
      >
        {cards.map((c) => (
          <div
            key={c.title}
            className="card-padded"
            style={{ borderLeft: `4px solid ${c.colour}` }}
          >
            <div className="flex items-center gap-2.5" style={{ marginBottom: 10 }}>
              <div
                style={{
                  width: 36,
                  height: 36,
                  background: c.bg,
                  borderRadius: 8,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 700,
                  color: c.colour,
                }}
              >
                {c.title.charAt(0)}
              </div>
              <div>
                <div className="display" style={{ fontSize: 14, fontWeight: 700, color: c.colour }}>
                  {c.title}
                </div>
                <div className="text-ink-muted" style={{ fontSize: 12, fontWeight: 600 }}>
                  {c.headline}
                </div>
              </div>
            </div>
            <p style={{ fontSize: 12, lineHeight: 1.5, marginBottom: 10 }}>{c.detail}</p>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {c.actions.map((a) => (
                <li
                  key={a}
                  style={{
                    fontSize: 12,
                    padding: '5px 0 5px 14px',
                    position: 'relative',
                    lineHeight: 1.4,
                  }}
                >
                  <span
                    style={{ position: 'absolute', left: 0, color: c.colour, fontWeight: 700 }}
                  >
                    →
                  </span>
                  {a}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* Year-by-year build plan */}
      <div className="card-padded mb-4">
        <h3 className="display" style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>
          Year-by-year build plan
        </h3>
        <div style={{ overflowX: 'auto' }}>
          <table className="w-full" style={{ borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr className="bg-bg text-ink-muted" style={{ textAlign: 'left' }}>
                {['Year', 'Revenue', 'EBITDA', 'Margin', 'Sites', 'Implied value', 'Focus'].map(
                  (h) => (
                    <th
                      key={h}
                      style={{
                        padding: 10,
                        fontSize: 10,
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        fontWeight: 700,
                      }}
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {calc.years.map((y) => {
                const isTarget = y.year === p.targetYears;
                return (
                  <tr
                    key={y.year}
                    style={{
                      borderBottom: '1px solid var(--border)',
                      background: isTarget
                        ? 'linear-gradient(90deg, #F3E8FF, transparent)'
                        : y.year === 0
                          ? 'var(--bg)'
                          : undefined,
                    }}
                  >
                    <td
                      style={{
                        padding: 10,
                        fontWeight: 700,
                        color: isTarget
                          ? '#7C3AED'
                          : y.year === 0
                            ? 'var(--ink-muted)'
                            : undefined,
                      }}
                    >
                      {y.year === 0 ? 'Now' : `Y${y.year}`}
                    </td>
                    <td style={{ padding: 10 }}>{formatCurrency(y.rev)}</td>
                    <td style={{ padding: 10 }}>{formatCurrency(y.ebitda)}</td>
                    <td style={{ padding: 10 }}>{y.margin.toFixed(1)}%</td>
                    <td style={{ padding: 10 }}>{y.sites}</td>
                    <td style={{ padding: 10, fontWeight: 700, color: '#7C3AED' }}>
                      {formatCurrency(y.valYear)}
                    </td>
                    <td className="text-ink-muted" style={{ padding: 10, fontSize: 11 }}>
                      {y.focus}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
