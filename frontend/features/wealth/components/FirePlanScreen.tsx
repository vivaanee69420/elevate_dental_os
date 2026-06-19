'use client';
// Exit Plan — the owner's personal endgame (DentaCFO gap Phase 4, REBUILT to the
// GM demo `exitCalc`). Six steps: the post-tax income you want → grossed up
// across people (each their own allowance) → freehold rent offset → the 4%-rule
// pot → the practice sale waterfall (reverse-solved required sale + forward
// target) → the 30-year compounding drawdown. Inputs persist (PUT /inputs); the
// sliders recompute live via POST /compute/exit-plan. Owner-only. Integer pence.
import { useEffect, useRef, useState } from 'react';
import { formatPence } from '@/lib/format';
import { useWealthInputs, useExitPlan, useExitPlanCompare, useComputeExitPlan, useSaveWealthInputs } from '../wealth-hooks';
import type { ExitPlanInput, ExitPlanResult, ExitPlanCompare } from '../wealth-api';

const toPounds = (pence: number) => Math.round(pence / 100);
const toPence = (pounds: number) => Math.round(pounds * 100);
const pctStr = (n: number) => `${n.toFixed(1)}%`;
// Clean, decimal-free pounds for headline figures (£4,303,494 not £4,303,493.79).
const gbp0 = (pence: number) => `£${toPounds(pence).toLocaleString('en-GB')}`;
// UK personal allowance — mirrors backend UK_INCOME_TAX.personalAllowancePence (£12,570).
const PERSONAL_ALLOWANCE_PENCE = 1_257_000;

function Stat({ label, value, accent }: { label: string; value: string; accent?: 'good' | 'bad' }) {
  const colour = accent === 'good' ? 'var(--success)' : accent === 'bad' ? 'var(--danger)' : 'var(--ink)';
  return (
    <div style={{ flex: 1, minWidth: 130 }}>
      <div className="text-ink-muted" style={{ fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, marginTop: 3, color: colour, lineHeight: 1.1 }}>{value}</div>
    </div>
  );
}

function Verdict({ c, retireAge }: { c: ExitPlanResult; retireAge: number }) {
  const ok = c.onTrack;
  const accent = ok ? 'var(--success)' : 'var(--danger)';
  const headline = ok
    ? 'On track to retire on this plan.'
    : `Shortfall of ${gbp0(c.gapPence)} to close.`;
  const stats = ok
    ? [
        { label: 'Sale price', value: gbp0(c.targetSalePence) },
        { label: 'Nets to invest', value: gbp0(c.investablePence), accent: 'good' as const },
        { label: 'Pot you need', value: gbp0(c.potNeededPence) },
        { label: 'Income / yr', value: gbp0(c.projection[0]?.incomePence ?? 0), accent: 'good' as const },
      ]
    : [
        { label: 'Pot you need', value: gbp0(c.potNeededPence) },
        { label: 'Sale needed', value: gbp0(c.requiredSalePence) },
        { label: 'Growth / yr', value: pctStr(c.reqGrowthPct), accent: 'bad' as const },
        { label: 'Or retire after', value: `age ${retireAge}+`, accent: 'bad' as const },
      ];
  return (
    <div className="card" style={{ marginBottom: 16, overflow: 'hidden' }}>
      <div style={{ borderLeft: `4px solid ${accent}`, padding: '18px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <span style={{
            fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6,
            color: 'white', background: accent, padding: '3px 10px', borderRadius: 999,
          }}>{ok ? 'On track' : 'Off track'}</span>
          <span style={{ fontSize: 16, fontWeight: 700 }}>{headline}</span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20 }}>
          {stats.map((s) => <Stat key={s.label} {...s} />)}
        </div>
        <div className="text-ink-muted" style={{ fontSize: 12, marginTop: 12 }}>
          {ok
            ? 'Income drawn rises for life under the 4% rule.'
            : 'Close the gap: grow the group, add freehold rent, or push your retirement date back.'}
        </div>
      </div>
    </div>
  );
}

function NumField({ label, value, onChange, suffix, step = 1 }: {
  label: string; value: number; onChange: (n: number) => void; suffix?: string; step?: number;
}) {
  return (
    <label style={{ display: 'block', fontSize: 12 }}>
      <span className="text-ink-muted" style={{ display: 'block', marginBottom: 4 }}>{label}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input type="number" value={Number.isFinite(value) ? value : 0} step={step}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{ width: '100%', padding: '7px 9px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13 }} />
        {suffix && <span className="text-ink-muted" style={{ fontSize: 12 }}>{suffix}</span>}
      </span>
    </label>
  );
}

function Slider({ label, value, min, max, step, suffix, onChange }: {
  label: string; value: number; min: number; max: number; step: number; suffix?: string; onChange: (n: number) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
      <span className="text-ink-muted" style={{ fontSize: 12, flex: 1 }}>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))} style={{ flex: 2 }} />
      <span style={{ fontSize: 13, fontWeight: 600, width: 64, textAlign: 'right' }}>{value}{suffix}</span>
    </div>
  );
}

function Card({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'good' | 'bad' }) {
  const colour = tone === 'good' ? 'var(--success)' : tone === 'bad' ? 'var(--danger)' : 'inherit';
  return (
    <div className="card-padded" style={{ flex: 1, minWidth: 150 }}>
      <div className="text-ink-muted" style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, margin: '4px 0', color: colour }}>{value}</div>
      {sub && <div className="text-ink-muted" style={{ fontSize: 11 }}>{sub}</div>}
    </div>
  );
}

// Saved-plan snapshot vs live re-resolved plan. Each row compares the figure the
// owner locked at save against today's live number, with a signed delta coloured
// by whether the move helps (a bigger pot NEEDED is a move the wrong way).
function DriftRow({ label, saved, live, fmt, upGood = true }: {
  label: string; saved: number; live: number; fmt: (n: number) => string; upGood?: boolean;
}) {
  const delta = live - saved;
  const flat = Math.abs(delta) < 1;
  const good = upGood ? delta > 0 : delta < 0;
  const colour = flat ? 'var(--ink-muted)' : good ? 'var(--success)' : 'var(--danger)';
  const arrow = flat ? '=' : delta > 0 ? '▲' : '▼';
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr', gap: 8, padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: 13, alignItems: 'center' }}>
      <span className="text-ink-muted">{label}</span>
      <span style={{ textAlign: 'right' }}>{fmt(saved)}</span>
      <span style={{ textAlign: 'right', fontWeight: 600 }}>{fmt(live)}</span>
      <span style={{ textAlign: 'right', color: colour, fontWeight: 600, fontSize: 12 }}>
        {flat ? '—' : `${arrow} ${fmt(Math.abs(delta))}`}
      </span>
    </div>
  );
}

function DriftPanel({ data }: { data: ExitPlanCompare }) {
  const { saved, live, updatedAt } = data;
  // Nothing saved yet — invite the owner to lock a baseline.
  if (!saved || !updatedAt) {
    return (
      <div className="card-padded" style={{ marginBottom: 16 }}>
        <div className="display font-bold" style={{ fontSize: 16, marginBottom: 4 }}>Plan vs live</div>
        <p className="text-ink-muted" style={{ fontSize: 12 }}>
          Save a plan to lock a baseline. Once saved, this shows how your live business value and the resulting plan have drifted since.
        </p>
      </div>
    );
  }
  const sp = saved.plan, lp = live.plan;
  const savedDate = new Date(updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const verdictChanged = sp.onTrack !== lp.onTrack;
  return (
    <div className="card-padded" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
        <div className="display font-bold" style={{ fontSize: 16 }}>Plan vs live</div>
        <div className="text-ink-muted" style={{ fontSize: 11 }}>baseline saved {savedDate}</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr', gap: 8, fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--ink-muted)', paddingBottom: 4 }}>
        <span>Metric</span>
        <span style={{ textAlign: 'right' }}>Saved</span>
        <span style={{ textAlign: 'right' }}>Live today</span>
        <span style={{ textAlign: 'right' }}>Change</span>
      </div>
      <DriftRow label="Group value" saved={saved.valuation.currentValuePence} live={live.valuation.currentValuePence} fmt={gbp0} />
      <DriftRow label="Sale price" saved={sp.targetSalePence} live={lp.targetSalePence} fmt={gbp0} />
      <DriftRow label="Nets to invest" saved={sp.investablePence} live={lp.investablePence} fmt={gbp0} />
      <DriftRow label="Pot you need" saved={sp.potNeededPence} live={lp.potNeededPence} fmt={gbp0} upGood={false} />
      <DriftRow label="Income / yr" saved={sp.projection[0]?.incomePence ?? 0} live={lp.projection[0]?.incomePence ?? 0} fmt={gbp0} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 12 }}>
        <span className="text-ink-muted">Verdict:</span>
        <Badge ok={sp.onTrack} text={sp.onTrack ? 'On track' : 'Off track'} dim />
        <span className="text-ink-muted">→</span>
        <Badge ok={lp.onTrack} text={lp.onTrack ? 'On track' : 'Off track'} />
        {verdictChanged && (
          <span style={{ fontSize: 11, color: lp.onTrack ? 'var(--success)' : 'var(--danger)', fontWeight: 600 }}>
            {lp.onTrack ? 'improved since save' : 'slipped since save'}
          </span>
        )}
      </div>
    </div>
  );
}

function Badge({ ok, text, dim }: { ok: boolean; text: string; dim?: boolean }) {
  const bg = ok ? 'var(--success)' : 'var(--danger)';
  return (
    <span style={{
      fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5,
      color: 'white', background: bg, padding: '2px 8px', borderRadius: 999, opacity: dim ? 0.5 : 1,
    }}>{text}</span>
  );
}

function Panel({ step, title, blurb, children }: { step: number; title: string; blurb: string; children: React.ReactNode }) {
  return (
    <div className="card-padded" style={{ marginBottom: 16 }}>
      <div style={{ marginBottom: 12 }}>
        <h3 className="display font-bold" style={{ fontSize: 16 }}>{step} · {title}</h3>
        <p className="text-ink-muted" style={{ fontSize: 12 }}>{blurb}</p>
      </div>
      {children}
    </div>
  );
}

export default function FirePlanScreen() {
  const inputs = useWealthInputs();
  const seed = useExitPlan();
  const drift = useExitPlanCompare();
  const compute = useComputeExitPlan();
  const save = useSaveWealthInputs();

  const [inp, setInp] = useState<ExitPlanInput | null>(null);
  const [result, setResult] = useState<ExitPlanResult | null>(null);
  const [showBreak, setShowBreak] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Seed the editable inputs + initial plan from /fire (already resolved: live
  // group value, seeded existing investments + freeholds).
  useEffect(() => {
    if (seed.data && !inp) {
      const { baseYear: _b, ...rest } = seed.data.inputs;
      setInp(rest);
      setResult(seed.data.plan);
    }
  }, [seed.data, inp]);

  // Debounced live recompute on any input change.
  useEffect(() => {
    if (!inp) return;
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      compute.mutate(inp, { onSuccess: setResult });
    }, 300);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inp]);

  if (inputs.isLoading || seed.isLoading) {
    return <div className="text-ink-muted" style={{ padding: 24 }}>Loading Exit Plan…</div>;
  }
  if (seed.error || !seed.data || !inp || !result) {
    return <div style={{ padding: 24, color: '#b91c1c' }}>Could not load the Exit Plan.</div>;
  }

  const c = result;
  const set = (patch: Partial<ExitPlanInput>) => setInp({ ...inp, ...patch });
  const valuationSource = seed.data.valuation.source;

  // Real-turnover seed: there is no manual baseline, so the group value is valued
  // from the live Dentally turnover at an assumed EBITDA margin. Recover the
  // buyer-type multiple from the seed (midpoint ÷ EBITDA) so the margin slider
  // can live-update the group value client-side, exactly matching the server.
  const vdetail = seed.data.valuation.detail;
  const isRealTurnover = valuationSource === 'real-turnover' && !!vdetail;
  const tierMultiple = isRealTurnover && vdetail?.ebitdaPence
    ? seed.data.valuation.currentValuePence / vdetail.ebitdaPence
    : 0;
  const setMargin = (m: number) => {
    const rev = vdetail?.annualRevenuePence ?? 0;
    const newVal = Math.round((rev * m / 100) * tierMultiple);
    set({ ebitdaMarginPct: m, currentValuePence: newVal, useLiveValuation: true });
  };

  // Income shown in the chosen unit; stored internally as ANNUAL pence.
  const incomeShownPounds = toPounds(inp.incomePer === 'month' ? Math.round(inp.incomePence / 12) : inp.incomePence);
  const setIncomeShown = (pounds: number) =>
    set({ incomePence: toPence(inp.incomePer === 'month' ? pounds * 12 : pounds) });

  const onSave = () => save.mutate({ exit: inp });

  return (
    <div className="mx-auto" style={{ maxWidth: 1100 }}>
      <div className="mb-6" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <h1 className="display font-bold" style={{ fontSize: 28 }}>Exit Plan</h1>
          <p className="text-ink-muted" style={{ fontSize: 13 }}>
            Your personal endgame — the income you want to retire on, the 4%-rule pot it demands, what the sale and freehold rent cover, and exactly what to build to get there.
          </p>
        </div>
        <button onClick={onSave} disabled={save.isPending} className="chip"
          style={{ padding: '8px 16px', fontWeight: 600, cursor: 'pointer', opacity: save.isPending ? 0.6 : 1 }}>
          {save.isPending ? 'Saving…' : 'Save plan'}
        </button>
      </div>

      {/* Verdict */}
      <Verdict c={c} retireAge={inp.retireAge} />

      {/* Plan vs live drift */}
      {drift.data && <DriftPanel data={drift.data} />}

      {/* 1 · Income + people */}
      <Panel step={1} title="What you want to retire on"
        blurb="Enter the take-home (post-tax) income you want. Split it across yourself, a partner and directors — each uses their own allowance and bands, so the gross you must generate drops.">
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'start' }}>
          <div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              {(['year', 'month'] as const).map((u) => (
                <button key={u} onClick={() => set({ incomePer: u })}
                  className="chip" style={{ padding: '4px 12px', cursor: 'pointer', background: inp.incomePer === u ? 'var(--brand)' : undefined, color: inp.incomePer === u ? 'white' : undefined }}>
                  Per {u}
                </button>
              ))}
            </div>
            <NumField label={`Income wanted, post-tax (£/${inp.incomePer})`} value={incomeShownPounds}
              step={inp.incomePer === 'month' ? 500 : 5000} onChange={setIncomeShown} />
            <div className="text-ink-muted" style={{ fontSize: 11, marginTop: 6 }}>
              That&apos;s {formatPence(c.annualNetPence)}/yr · {formatPence(Math.round(c.annualNetPence / 12))}/mo net.
            </div>
          </div>
          <div>
            <div className="text-ink-muted" style={{ fontSize: 12, marginBottom: 6 }}>People sharing the income</div>
            {inp.people.map((p, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                <input value={p.name} placeholder="Name"
                  onChange={(e) => { const people = [...inp.people]; people[i] = { ...p, name: e.target.value }; set({ people }); }}
                  style={{ flex: 1, padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13 }} />
                <input type="number" value={p.share} step={0.5} title="share"
                  onChange={(e) => { const people = [...inp.people]; people[i] = { ...p, share: Number(e.target.value) }; set({ people }); }}
                  style={{ width: 70, padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, textAlign: 'right' }} />
                {inp.people.length > 1 && (
                  <button onClick={() => set({ people: inp.people.filter((_, j) => j !== i) })}
                    style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--danger)' }}>✕</button>
                )}
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button className="chip" style={{ cursor: 'pointer', padding: '4px 10px' }}
                onClick={() => set({ people: [...inp.people, { name: 'Partner', share: 1 }] })}>＋ Partner</button>
              <button className="chip" style={{ cursor: 'pointer', padding: '4px 10px' }}
                onClick={() => set({ people: [...inp.people, { name: `Director ${inp.people.length}`, share: 1 }] })}>＋ Director</button>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
          <Card label="Gross income to generate" value={formatPence(c.grossRequiredPence)} sub={`gross to net ${formatPence(c.annualNetPence)} across ${c.people.length} ${c.people.length > 1 ? 'people' : 'person'}`} />
          <Card label="Tax saved by splitting" value={c.taxSavingPence > 0 ? `${formatPence(c.taxSavingPence)}/yr` : '£0'} sub={c.taxSavingPence > 0 ? `vs one earner (${formatPence(c.singleGrossPence)} gross)` : 'no split benefit yet'} tone={c.taxSavingPence > 0 ? 'good' : undefined} />
        </div>
        <div style={{ marginTop: 12 }}>
          {c.people.map((p, i) => {
            const taxFree = p.taxPence === 0 && p.netPence <= PERSONAL_ALLOWANCE_PENCE;
            return (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                <span style={{ fontWeight: 600 }}>{p.name}</span>
                <span className="text-ink-muted">net {formatPence(p.netPence)}</span>
                <span className="text-ink-muted">gross {formatPence(p.grossPence)}</span>
                <span style={{ color: taxFree ? 'var(--ink-muted)' : '#b06a1f' }}>
                  tax {formatPence(p.taxPence)}
                  {taxFree && <span style={{ fontSize: 10, marginLeft: 4 }}>(within allowance)</span>}
                </span>
              </div>
            );
          })}
          {c.people.some((p) => p.taxPence === 0 && p.netPence <= PERSONAL_ALLOWANCE_PENCE) && (
            <p className="text-ink-muted" style={{ fontSize: 10, marginTop: 8 }}>
              Each person&apos;s slice is below the £12,570 personal allowance, so it is drawn tax-free. Raise the income wanted, or reduce the number of people, to push slices into the taxed bands.
            </p>
          )}
        </div>
      </Panel>

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* 2 · Timeline */}
        <Panel step={2} title="Your timeline" blurb="We reverse-engineer the plan from your age.">
          <Slider label="Your age now" value={inp.currentAge} min={30} max={70} step={1} onChange={(n) => set({ currentAge: n })} />
          <Slider label="Age you want to retire" value={inp.retireAge} min={40} max={75} step={1} onChange={(n) => set({ retireAge: n })} />
          <Card label="Runway" value={`${c.years} yrs`} sub={`exit ${c.exitYear} (age ${inp.retireAge})`} />
        </Panel>

        {/* 3 · Freeholds */}
        <Panel step={3} title="Freehold properties" blurb="If you own the building your practice trades from (or any rental property), add it here. The rent it earns counts as retirement income, so you need a smaller investment pot.">
          {inp.freeholds.length > 0 && (
            <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              <span className="text-ink-muted" style={{ flex: 1, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>Property name</span>
              <span className="text-ink-muted" style={{ width: 110, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, textAlign: 'right' }}>Value (£)</span>
              <span className="text-ink-muted" style={{ width: 100, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, textAlign: 'right' }}>Rent (£/yr)</span>
              <span style={{ width: 16 }} />
            </div>
          )}
          {inp.freeholds.map((f, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              <input value={f.name} placeholder="e.g. Practice building, High St"
                onChange={(e) => { const freeholds = [...inp.freeholds]; freeholds[i] = { ...f, name: e.target.value }; set({ freeholds }); }}
                style={{ flex: 1, padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13 }} />
              <input type="number" value={toPounds(f.valuePence)} step={50000} title="Property market value (£)" placeholder="0"
                onChange={(e) => { const freeholds = [...inp.freeholds]; freeholds[i] = { ...f, valuePence: toPence(Number(e.target.value)) }; set({ freeholds }); }}
                style={{ width: 110, padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, textAlign: 'right' }} />
              <input type="number" value={toPounds(f.rentPence)} step={5000} title="Annual rent received (£/yr)" placeholder="0"
                onChange={(e) => { const freeholds = [...inp.freeholds]; freeholds[i] = { ...f, rentPence: toPence(Number(e.target.value)) }; set({ freeholds }); }}
                style={{ width: 100, padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, textAlign: 'right' }} />
              <button onClick={() => set({ freeholds: inp.freeholds.filter((_, j) => j !== i) })} title="Remove"
                style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--danger)', width: 16 }}>✕</button>
            </div>
          ))}
          {inp.freeholds.length === 0 && (
            <p className="text-ink-muted" style={{ fontSize: 12 }}>No properties yet. Add one if you own premises you rent out — skip this if you don&apos;t.</p>
          )}
          <button className="chip" style={{ cursor: 'pointer', padding: '4px 10px', marginTop: 8 }}
            onClick={() => set({ freeholds: [...inp.freeholds, { name: 'Freehold', valuePence: 0, rentPence: 0 }] })}>＋ Freehold</button>
          <div style={{ marginTop: 12 }}>
            <Card label="Total rent" value={`${formatPence(c.totalRentPence)}/yr`} sub={`freehold worth ${formatPence(c.totalFreeholdPence)}`} />
          </div>
          {seed.data.seeds.freeholdsSeeded && c.totalFreeholdPence > 0 && (
            <p className="text-ink-muted" style={{ fontSize: 10, marginTop: 8 }}>Seeded from your buy-to-let / income properties on Net Worth.</p>
          )}
        </Panel>
      </div>

      {/* 4 · The pot */}
      <Panel step={4} title="The pot — the 4% rule" blurb="Your portfolio must produce the gross income left after freehold rent. The 4% rule sizes the pot.">
        <Slider label="Safe withdrawal rate" value={inp.withdrawPct} min={3} max={5} step={0.25} suffix="%" onChange={(n) => set({ withdrawPct: n })} />
        <Slider label="Investment return" value={inp.returnPct} min={4} max={12} step={0.5} suffix="%" onChange={(n) => set({ returnPct: n })} />
        <div style={{ display: 'flex', gap: 12, marginTop: 6, flexWrap: 'wrap' }}>
          <Card label="Investment pot required" value={formatPence(c.potNeededPence)} sub={`4% rule on ${formatPence(c.portfolioGrossPence)}/yr from the portfolio`} />
          <Card label="From portfolio" value={`${formatPence(c.portfolioGrossPence)}/yr`} sub="drawn each year" />
          <Card label="From freehold rent" value={`${formatPence(c.totalRentPence)}/yr`} sub="passive income" />
        </div>
      </Panel>

      {/* 5 · Selling the practice */}
      <Panel step={5} title="Selling the practice" blurb="What lands in your pocket after the agent and the taxman — that's what you invest.">
        <div className="grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 14 }}>
          <NumField label="Group value today (£)" value={toPounds(inp.currentValuePence)} step={100000}
            onChange={(n) => set({ currentValuePence: toPence(n), useLiveValuation: false })} />
          <NumField label="Target sale price (£) — 0 = auto" value={toPounds(inp.targetSalePence)} step={100000}
            onChange={(n) => set({ targetSalePence: toPence(n) })} />
          <NumField label="Agent / broker fee" suffix="%" value={inp.agentPct} step={0.25}
            onChange={(n) => set({ agentPct: n })} />
          <NumField label="Capital gains tax" suffix="%" value={inp.cgtPct} step={1}
            onChange={(n) => set({ cgtPct: n })} />
          <NumField label="Cost base / not taxed (£)" value={toPounds(inp.baseCostPence)} step={50000}
            onChange={(n) => set({ baseCostPence: toPence(n) })} />
          <NumField label="Existing investments (£)" value={toPounds(inp.existingInvestPence)} step={50000}
            onChange={(n) => set({ existingInvestPence: toPence(n) })} />
          {isRealTurnover && inp.useLiveValuation && (
            <NumField label="Assumed EBITDA margin" suffix="%" value={inp.ebitdaMarginPct} step={1}
              onChange={(n) => setMargin(n)} />
          )}
        </div>
        {valuationSource === 'live' && inp.useLiveValuation && (
          <p className="text-ink-muted" style={{ fontSize: 10, marginBottom: 8 }}>Group value seeded live from the valuation midpoint — edit to override.</p>
        )}
        {isRealTurnover && inp.useLiveValuation && vdetail && (
          <p className="text-ink-muted" style={{ fontSize: 10, marginBottom: 8 }}>
            No manual baseline set — group value seeded from real turnover{' '}
            <strong>{formatPence(vdetail.annualRevenuePence ?? 0)}</strong> (last 12 months, Dentally) at{' '}
            {inp.ebitdaMarginPct}% EBITDA margin. Revenue-multiple cross-check:{' '}
            <strong>{formatPence(vdetail.revenueMultipleValuePence ?? 0)}</strong> ({vdetail.revenueMultiple ?? 0}× turnover). Edit any field to override.
          </p>
        )}

        <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 13, maxWidth: 460 }}>
          {([
            ['Sale price', c.targetSalePence],
            ['Agent / broker fee', -c.agentFeePence],
            ['Capital gains tax', -c.cgtPence],
            ['Net from sale', c.netProceedsPence],
            ['＋ Existing investments', inp.existingInvestPence],
          ] as [string, number][]).map(([label, val], i) => (
            <li key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--border)', fontWeight: i === 3 ? 700 : 400 }}>
              <span className={i === 3 ? '' : 'text-ink-muted'}>{label}</span>
              <span>{formatPence(val)}</span>
            </li>
          ))}
          <li style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', fontWeight: 700, fontSize: 15 }}>
            <span>Cash to invest</span><span>{formatPence(c.investablePence)}</span>
          </li>
        </ul>

        <div style={{ display: 'flex', gap: 12, marginTop: 14, flexWrap: 'wrap' }}>
          <Card label="Pot gap" value={c.onTrack ? 'Covered' : formatPence(c.gapPence)} sub={c.onTrack ? `${formatPence(Math.max(0, -c.gapPence))} ahead` : 'shortfall to the pot'} tone={c.onTrack ? 'good' : 'bad'} />
          <Card label="Sale needed to fund pot" value={formatPence(c.requiredSalePence)} sub={`at ${c.reqGrowthPct > 0 ? pctStr(c.reqGrowthPct) + '/yr' : '0% — already there'} growth`} />
          <Card label="Your target implies" value={c.targetGrowthPct > 0 ? `${pctStr(c.targetGrowthPct)}/yr` : '0%'} sub="growth from today's value" />
        </div>
        <p className="text-ink-muted" style={{ fontSize: 11, marginTop: 10 }}>
          To fund a <strong>{formatPence(c.potNeededPence)}</strong> pot you need <strong>{formatPence(c.requiredNetPence)}</strong> after sale costs — a sale price of <strong>{formatPence(c.requiredSalePence)}</strong>. From today&apos;s <strong>{formatPence(inp.currentValuePence)}</strong> that&apos;s <strong>{c.reqGrowthPct > 0 ? `${pctStr(c.reqGrowthPct)} for ${c.years} years` : "already covered by today's modelled value"}</strong>.
        </p>
      </Panel>

      {/* 6 · Compounding */}
      <Panel step={6} title="Compounding — take 4% every year" blurb="Where the invested money leads if it grows and you draw your withdrawal rate annually.">
        <button className="chip" style={{ cursor: 'pointer', padding: '4px 12px', marginBottom: 12 }} onClick={() => setShowBreak((s) => !s)}>
          {showBreak ? 'Hide 30-year breakdown' : 'Show 30-year breakdown'}
        </button>
        {showBreak ? (
          <>
            <p className="text-ink-muted" style={{ fontSize: 12, marginBottom: 10 }}>
              Invest <strong>{formatPence(c.investablePence)}</strong> at <strong>{c.returnPct}%</strong>, draw <strong>{c.withdrawPct}%</strong> of the balance each year. Because {c.returnPct}% &gt; {c.withdrawPct}%, the pot and your income both compound upward — income rises from <strong>{formatPence(c.projection[0]?.incomePence ?? 0)}</strong> to <strong>{formatPence(c.projection[c.projection.length - 1]?.incomePence ?? 0)}</strong>/yr and the pot grows to <strong>{formatPence(c.projection[c.projection.length - 1]?.endPence ?? 0)}</strong> after 30 years.
            </p>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 560 }}>
                <thead>
                  <tr className="text-ink-muted" style={{ textAlign: 'right' }}>
                    <th style={{ textAlign: 'left', padding: '6px 8px' }}>Year</th>
                    <th style={{ padding: '6px 8px' }}>Age</th>
                    <th style={{ padding: '6px 8px' }}>Pot start</th>
                    <th style={{ padding: '6px 8px' }}>Growth ({c.returnPct}%)</th>
                    <th style={{ padding: '6px 8px' }}>Income drawn ({c.withdrawPct}%)</th>
                    <th style={{ padding: '6px 8px' }}>Pot end</th>
                  </tr>
                </thead>
                <tbody>
                  {c.projection.map((p) => (
                    <tr key={p.year} style={{ borderTop: '1px solid var(--border)', textAlign: 'right' }}>
                      <td style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>{p.year}</td>
                      <td style={{ padding: '6px 8px' }}>{p.age}</td>
                      <td style={{ padding: '6px 8px' }}>{formatPence(p.startPence)}</td>
                      <td style={{ padding: '6px 8px', color: 'var(--success)' }}>+{formatPence(p.growthPence)}</td>
                      <td style={{ padding: '6px 8px', color: '#b06a1f' }}>−{formatPence(p.incomePence)}</td>
                      <td style={{ padding: '6px 8px', fontWeight: 600 }}>{formatPence(p.endPence)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="text-ink-muted" style={{ fontSize: 12 }}>
            Show the 30-year breakdown to project the invested pot at {c.returnPct}% growth with a {c.withdrawPct}% annual draw.
          </p>
        )}
      </Panel>

      <p className="text-ink-muted" style={{ fontSize: 11 }}>
        UK income-tax bands 2025/26 used for the gross-up (allowance £12,570, 20/40/45%; allowance tapers over £100k). The 4% rule draws the withdrawal rate of the balance each year; with returns above it the pot keeps growing. Sale assumes the agent fee + CGT rate you set ({valuationSource === 'live' ? 'group value from the live valuation midpoint' : 'manual group value'}). Planning estimates — confirm tax and returns with your accountant &amp; IFA.
      </p>
      {save.isError && <p style={{ color: '#b91c1c', fontSize: 12, marginTop: 8 }}>Save failed: {String(save.error?.message ?? '')}</p>}
    </div>
  );
}
