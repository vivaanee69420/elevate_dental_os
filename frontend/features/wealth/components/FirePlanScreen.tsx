'use client';
// Exit Plan — the owner's personal endgame (DentaCFO gap Phase 4, REBUILT to the
// GM demo `exitCalc`). Six steps: the post-tax income you want → grossed up
// across people (each their own allowance) → freehold rent offset → the 4%-rule
// pot → the practice sale waterfall (reverse-solved required sale + forward
// target) → the 30-year compounding drawdown. Inputs persist (PUT /inputs); the
// sliders recompute live via POST /compute/exit-plan. Owner-only. Integer pence.
import { useEffect, useRef, useState } from 'react';
import { formatPence } from '@/lib/format';
import { useWealthInputs, useExitPlan, useComputeExitPlan, useSaveWealthInputs } from '../wealth-hooks';
import type { ExitPlanInput, ExitPlanResult } from '../wealth-api';

const toPounds = (pence: number) => Math.round(pence / 100);
const toPence = (pounds: number) => Math.round(pounds * 100);
const pctStr = (n: number) => `${n.toFixed(1)}%`;

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
      <div className="card-padded" style={{ marginBottom: 16, borderLeft: `4px solid ${c.onTrack ? 'var(--success)' : 'var(--danger)'}` }}>
        <div className="text-ink-muted" style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>Verdict</div>
        <div style={{ fontSize: 15, fontWeight: 700, marginTop: 4, lineHeight: 1.45 }}>
          {c.onTrack
            ? `On track — selling for ${formatPence(c.targetSalePence)} nets ${formatPence(c.investablePence)} to invest, at or above the ${formatPence(c.potNeededPence)} pot you need. Income drawn: ${formatPence(c.projection[0]?.incomePence ?? 0)}/yr, rising for life.`
            : `Shortfall ${formatPence(c.gapPence)} — grow the group to ~${formatPence(c.requiredSalePence)} (${pctStr(c.reqGrowthPct)}/yr), add freehold rent, or push retirement past age ${inp.retireAge}.`}
        </div>
      </div>

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
          {c.people.map((p, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
              <span style={{ fontWeight: 600 }}>{p.name}</span>
              <span className="text-ink-muted">net {formatPence(p.netPence)}</span>
              <span className="text-ink-muted">gross {formatPence(p.grossPence)}</span>
              <span style={{ color: '#b06a1f' }}>tax {formatPence(p.taxPence)}</span>
            </div>
          ))}
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
        <Panel step={3} title="Freehold properties" blurb="Rent is added to your income — it shrinks the pot you need.">
          {inp.freeholds.map((f, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              <input value={f.name} placeholder="Property"
                onChange={(e) => { const freeholds = [...inp.freeholds]; freeholds[i] = { ...f, name: e.target.value }; set({ freeholds }); }}
                style={{ flex: 1, padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13 }} />
              <input type="number" value={toPounds(f.valuePence)} step={50000} title="value £"
                onChange={(e) => { const freeholds = [...inp.freeholds]; freeholds[i] = { ...f, valuePence: toPence(Number(e.target.value)) }; set({ freeholds }); }}
                style={{ width: 110, padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, textAlign: 'right' }} />
              <input type="number" value={toPounds(f.rentPence)} step={5000} title="rent £/yr"
                onChange={(e) => { const freeholds = [...inp.freeholds]; freeholds[i] = { ...f, rentPence: toPence(Number(e.target.value)) }; set({ freeholds }); }}
                style={{ width: 100, padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, textAlign: 'right' }} />
              <button onClick={() => set({ freeholds: inp.freeholds.filter((_, j) => j !== i) })}
                style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--danger)' }}>✕</button>
            </div>
          ))}
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
        </div>
        {seed.data.valuation.source === 'live' && inp.useLiveValuation && (
          <p className="text-ink-muted" style={{ fontSize: 10, marginBottom: 8 }}>Group value seeded live from the valuation midpoint — edit to override.</p>
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
