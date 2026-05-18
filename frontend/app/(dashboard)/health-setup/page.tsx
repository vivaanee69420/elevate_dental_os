'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

const STEPS = [
  { id: 0, title: 'Welcome', desc: 'How this works' },
  { id: 1, title: 'The Numbers', desc: 'Revenue, profit, cash' },
  { id: 2, title: 'Your Team', desc: 'Associates, staff, chairs' },
  { id: 3, title: 'Your Patients', desc: 'Base, conversion, retention' },
  { id: 4, title: 'Cost Structure', desc: 'Where the money goes' },
  { id: 5, title: 'Your Targets', desc: 'Where you want to be' },
  { id: 6, title: 'Exit Strategy', desc: 'The endgame' },
  { id: 7, title: 'Review & Confirm', desc: 'AI analysis of your data' },
];

export default function HealthSetupPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: health } = useQuery({
    queryKey: ['health'],
    queryFn: () => api('/api/health'),
  });

  const [step, setStep] = useState(0);
  const [baseline, setBaseline] = useState<Record<string, any>>({});
  const [targets, setTargets] = useState<Record<string, any>>({});

  useEffect(() => {
    if (health) {
      setStep(health.setup_step || 0);
      setBaseline(health.baseline || {});
      setTargets(health.targets || {});
    }
  }, [health]);

  const saveMutation = useMutation({
    mutationFn: (payload: any) => api('/api/health', { method: 'PUT', body: JSON.stringify(payload) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['health'] }),
  });

  function updateBaseline(key: string, value: any) {
    const next = { ...baseline, [key]: value };
    setBaseline(next);
    saveMutation.mutate({ baseline: { [key]: value } });
  }

  function updateTargets(key: string, value: any) {
    const next = { ...targets, [key]: value };
    setTargets(next);
    saveMutation.mutate({ targets: { [key]: value } });
  }

  function gotoStep(n: number) {
    setStep(n);
    saveMutation.mutate({ setup_step: n });
  }

  function complete() {
    saveMutation.mutate({ setup_completed: true, setup_step: 7 });
    router.push('/progress');
  }

  const completionPct = (() => {
    const required = ['revenue', 'profit', 'cash', 'debt', 'associates', 'chairs', 'active_patients', 'new_per_month', 'conversion', 'case_value', 'fta_rate'];
    const filled = required.filter((k) => baseline[k] !== undefined && baseline[k] !== '').length;
    const targetFilled = targets.years && targets.profit_multiple && targets.exit_strategy ? 3 : 0;
    return Math.round(((filled + targetFilled) / (required.length + 3)) * 100);
  })();

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex justify-between items-end mb-4">
        <div>
          <h1 className="display text-3xl font-bold">Business Health Setup</h1>
          <p className="text-ink-muted text-sm mt-1">Tell us where you are today — we use this to track every improvement</p>
        </div>
        <div className="text-right">
          <div className="text-xs text-ink-muted uppercase">Setup completion</div>
          <div className={`display text-4xl font-bold ${completionPct === 100 ? 'text-success' : 'text-brand'}`}>{completionPct}%</div>
        </div>
      </div>

      {/* Stepper */}
      <div className="flex gap-1 mb-4">
        {STEPS.map((s) => (
          <button
            key={s.id}
            onClick={() => gotoStep(s.id)}
            className={`flex-1 px-3 py-2 rounded-md text-xs border ${
              s.id === step ? 'bg-brand text-white border-brand' :
              s.id < step ? 'bg-brand-50 text-brand border-brand' :
              'bg-card text-ink-muted border-border'
            }`}
          >
            <div className="opacity-80">{s.id === 0 ? 'START' : `STEP ${s.id}`}</div>
            <div className="font-semibold mt-1">{s.title}</div>
            {s.id < step && <div className="text-[10px] mt-1">✓ Done</div>}
          </button>
        ))}
      </div>

      {step === 0 && <Welcome onNext={() => gotoStep(1)} />}
      {step === 1 && <Numbers baseline={baseline} update={updateBaseline} onBack={() => gotoStep(0)} onNext={() => gotoStep(2)} />}
      {step === 2 && <Team baseline={baseline} update={updateBaseline} onBack={() => gotoStep(1)} onNext={() => gotoStep(3)} />}
      {step === 3 && <Patients baseline={baseline} update={updateBaseline} onBack={() => gotoStep(2)} onNext={() => gotoStep(4)} />}
      {step === 4 && <Costs baseline={baseline} update={updateBaseline} onBack={() => gotoStep(3)} onNext={() => gotoStep(5)} />}
      {step === 5 && <Targets baseline={baseline} targets={targets} update={updateTargets} onBack={() => gotoStep(4)} onNext={() => gotoStep(6)} />}
      {step === 6 && <ExitStrategy targets={targets} update={updateTargets} onBack={() => gotoStep(5)} onNext={() => gotoStep(7)} />}
      {step === 7 && <Review baseline={baseline} targets={targets} onBack={() => gotoStep(6)} onComplete={complete} />}
    </div>
  );
}

// ============================================================================
// STEP COMPONENTS (extract to their own files in production)
// ============================================================================

function Welcome({ onNext }: { onNext: () => void }) {
  return (
    <>
      <div className="card-padded text-white mb-4" style={{ background: 'linear-gradient(135deg, #0E7C7B, #085857)' }}>
        <h2 className="display text-3xl font-bold mb-3">Welcome to Business Health</h2>
        <p className="opacity-95 mb-5">In the next 10 minutes you'll capture exactly where your business is today. Then Elevate will:</p>
        <div className="grid grid-cols-2 gap-3">
          {[
            { icon: '📊', title: 'Auto-populate every dashboard', desc: 'Your numbers flow into P&L, KPIs, valuation, scorecard.' },
            { icon: '📈', title: 'Track every change monthly', desc: 'Snapshots show what\'s improving and what\'s not.' },
            { icon: '🎯', title: 'Set 3-year targets', desc: 'Double profit. Sell at 8× EBITDA. Whatever your goal.' },
            { icon: '🤖', title: 'Plan4Growth AI becomes your coach', desc: 'Specific actions based on your data, every week.' },
          ].map((b) => (
            <div key={b.title} className="bg-white/10 p-4 rounded-lg">
              <div className="text-2xl mb-1">{b.icon}</div>
              <div className="font-semibold">{b.title}</div>
              <div className="text-xs opacity-85 mt-1">{b.desc}</div>
            </div>
          ))}
        </div>
      </div>
      <button onClick={onNext} className="btn-primary text-base px-6 py-3">Let's start →</button>
    </>
  );
}

function NumberInput({ label, helper, value, onChange, placeholder, prefix, required }: any) {
  return (
    <div>
      <label className="text-xs font-semibold">{label} {required && <span className="text-danger">*</span>}</label>
      {helper && <div className="text-[11px] text-ink-muted mb-1.5">{helper}</div>}
      <div className="relative">
        {prefix && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted">{prefix}</span>}
        <input
          type="number"
          value={value ?? ''}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          placeholder={placeholder}
          className={`input w-full ${prefix ? 'pl-7' : ''}`}
        />
      </div>
    </div>
  );
}

function Numbers({ baseline, update, onBack, onNext }: any) {
  return (
    <>
      <div className="card-padded mb-4">
        <h2 className="display text-xl font-semibold mb-1">The Numbers</h2>
        <p className="text-sm text-ink-muted mb-5">Pull these from your last set of accounts.</p>
        <div className="grid grid-cols-2 gap-4">
          <NumberInput required label="Annual revenue (TTM)" helper="Total income last 12 months" prefix="£" value={baseline.revenue} onChange={(v: number) => update('revenue', v)} placeholder="4,590,000" />
          <NumberInput required label="Net profit (TTM)" helper="After costs, before owner pay" prefix="£" value={baseline.profit} onChange={(v: number) => update('profit', v)} placeholder="459,000" />
          <NumberInput required label="Cash at bank (today)" prefix="£" value={baseline.cash} onChange={(v: number) => update('cash', v)} placeholder="287,000" />
          <NumberInput required label="Total business debt" helper="Bank loans + finance only" prefix="£" value={baseline.debt} onChange={(v: number) => update('debt', v)} placeholder="180,000" />
          <NumberInput label="Revenue 1 year ago" helper="For growth tracking" prefix="£" value={baseline.revenue_prior} onChange={(v: number) => update('revenue_prior', v)} placeholder="4,180,000" />
          <NumberInput label="Profit 1 year ago" prefix="£" value={baseline.profit_prior} onChange={(v: number) => update('profit_prior', v)} placeholder="438,000" />
        </div>
        {baseline.revenue && baseline.profit && (
          <div className="mt-5 p-3.5 bg-brand-50 rounded-lg">
            <div className="text-xs text-brand uppercase font-semibold">✨ Instant insight</div>
            <div className="text-sm mt-1">Your net profit margin is <strong>{((baseline.profit / baseline.revenue) * 100).toFixed(1)}%</strong>. UK dental average is 15%. Top quartile is 20%+.</div>
          </div>
        )}
      </div>
      <NavButtons onBack={onBack} onNext={onNext} />
    </>
  );
}

function Team({ baseline, update, onBack, onNext }: any) {
  return (
    <>
      <div className="card-padded mb-4">
        <h2 className="display text-xl font-semibold mb-1">Your Team & Capacity</h2>
        <p className="text-sm text-ink-muted mb-5">Physical and human capacity.</p>
        <div className="grid grid-cols-3 gap-4">
          <NumberInput required label="Number of practices" value={baseline.practices} onChange={(v: number) => update('practices', v)} placeholder="5" />
          <NumberInput required label="Total chairs" value={baseline.chairs} onChange={(v: number) => update('chairs', v)} placeholder="18" />
          <NumberInput required label="Associate clinicians" value={baseline.associates} onChange={(v: number) => update('associates', v)} placeholder="8" />
          <NumberInput label="Hygienists / therapists" value={baseline.hygienists} onChange={(v: number) => update('hygienists', v)} placeholder="6" />
          <NumberInput label="Dental nurses" value={baseline.nurses} onChange={(v: number) => update('nurses', v)} placeholder="14" />
          <NumberInput label="Reception / admin" value={baseline.admin} onChange={(v: number) => update('admin', v)} placeholder="10" />
          <NumberInput label="Practice managers" value={baseline.managers} onChange={(v: number) => update('managers', v)} placeholder="3" />
          <NumberInput label="Chair utilisation %" helper="% of available time booked" value={baseline.utilisation} onChange={(v: number) => update('utilisation', v)} placeholder="78" />
        </div>
      </div>
      <NavButtons onBack={onBack} onNext={onNext} />
    </>
  );
}

function Patients({ baseline, update, onBack, onNext }: any) {
  return (
    <>
      <div className="card-padded mb-4">
        <h2 className="display text-xl font-semibold mb-1">Patients & Conversion</h2>
        <p className="text-sm text-ink-muted mb-5">The lifeblood of the business. Estimate where you don't track exactly.</p>
        <div className="grid grid-cols-3 gap-4">
          <NumberInput required label="Active patient base" helper="Visited within 24 months" value={baseline.active_patients} onChange={(v: number) => update('active_patients', v)} placeholder="14,820" />
          <NumberInput label="Lapsed patients" helper="No visit 12+ months" value={baseline.lapsed} onChange={(v: number) => update('lapsed', v)} placeholder="2,380" />
          <NumberInput label="Plan members" helper="Recurring monthly payers" value={baseline.plan_members} onChange={(v: number) => update('plan_members', v)} placeholder="2,600" />
          <NumberInput required label="Leads / month" helper="All enquiries" value={baseline.leads_per_month} onChange={(v: number) => update('leads_per_month', v)} placeholder="380" />
          <NumberInput required label="New patients / month" helper="Actually started treatment" value={baseline.new_per_month} onChange={(v: number) => update('new_per_month', v)} placeholder="187" />
          <NumberInput label="Conversion %" value={baseline.conversion} onChange={(v: number) => update('conversion', v)} placeholder="11.5" />
          <NumberInput required label="Average case value (£)" value={baseline.case_value} onChange={(v: number) => update('case_value', v)} placeholder="2,850" />
          <NumberInput required label="FTA / no-show rate %" value={baseline.fta_rate} onChange={(v: number) => update('fta_rate', v)} placeholder="4.2" />
          <NumberInput label="% private revenue" helper="vs NHS" value={baseline.private_pct} onChange={(v: number) => update('private_pct', v)} placeholder="72" />
        </div>
      </div>
      <NavButtons onBack={onBack} onNext={onNext} />
    </>
  );
}

function Costs({ baseline, update, onBack, onNext }: any) {
  const cats = [
    { id: 'cost_associates', label: 'Associate pay', bench: 42, target: 40 },
    { id: 'cost_lab', label: 'Lab fees', bench: 10, target: 9 },
    { id: 'cost_materials', label: 'Materials & consumables', bench: 6, target: 5 },
    { id: 'cost_staff', label: 'Staff costs (excl. clinicians)', bench: 17, target: 15 },
    { id: 'cost_property', label: 'Property & facilities', bench: 7, target: 6 },
    { id: 'cost_marketing', label: 'Marketing', bench: 4, target: 5 },
    { id: 'cost_other', label: 'Other operating costs', bench: 6, target: 5 },
  ];
  const totalPct = cats.reduce((s, c) => s + (parseFloat(baseline[c.id]) || 0), 0);
  return (
    <>
      <div className="card-padded mb-4">
        <h2 className="display text-xl font-semibold mb-1">Cost Structure</h2>
        <p className="text-sm text-ink-muted mb-5">Enter as % of revenue. Skip if unsure.</p>
        {cats.map((c) => (
          <div key={c.id} className="grid grid-cols-[2fr,1fr,1fr,1fr] gap-3 items-center py-3 border-b border-border">
            <div className="text-sm font-semibold">{c.label}</div>
            <input type="number" step="0.1" value={baseline[c.id] ?? ''} onChange={(e) => update(c.id, parseFloat(e.target.value) || 0)} className="input" placeholder="0" />
            <div className="text-xs text-ink-muted text-right">UK avg: {c.bench}%</div>
            <div className="text-xs text-ink-muted text-right">Top: {c.target}%</div>
          </div>
        ))}
        <div className="mt-4 p-3 bg-bg rounded-lg text-center">
          <span className="text-sm text-ink-muted">Total costs:</span>
          <span className="display text-2xl font-bold text-brand ml-2">{totalPct.toFixed(1)}%</span>
          <span className="text-sm text-ink-muted ml-6">Implied margin:</span>
          <span className="display text-2xl font-bold text-success ml-2">{(100 - totalPct).toFixed(1)}%</span>
        </div>
      </div>
      <NavButtons onBack={onBack} onNext={onNext} />
    </>
  );
}

function Targets({ baseline, targets, update, onBack, onNext }: any) {
  return (
    <>
      <div className="card-padded mb-4">
        <h2 className="display text-xl font-semibold mb-1">Where Do You Want To Be?</h2>
        <p className="text-sm text-ink-muted mb-5">Set the target. We'll model the path.</p>
        <div className="grid grid-cols-2 gap-4 mb-5">
          <div>
            <label className="text-xs font-semibold">Time horizon *</label>
            <select value={targets.years || ''} onChange={(e) => update('years', parseInt(e.target.value))} className="input w-full mt-1.5">
              <option value="">Choose...</option>
              <option value={1}>1 year (fast turnaround)</option>
              <option value={3}>3 years (typical)</option>
              <option value={5}>5 years (longer build)</option>
              <option value={7}>7 years (full exit prep)</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold">Profit growth target *</label>
            <select value={targets.profit_multiple || ''} onChange={(e) => update('profit_multiple', parseFloat(e.target.value))} className="input w-full mt-1.5">
              <option value="">Choose...</option>
              <option value={1.5}>1.5× current profit</option>
              <option value={2.0}>2.0× current profit</option>
              <option value={2.5}>2.5× current profit</option>
              <option value={3.0}>3.0× current profit</option>
            </select>
          </div>
        </div>
        <div>
          <label className="text-xs font-semibold mb-2 block">Top priorities to focus on</label>
          <div className="grid grid-cols-3 gap-2.5">
            {[
              { id: 'priority_profit', label: 'Profitability', icon: '💰' },
              { id: 'priority_growth', label: 'Revenue growth', icon: '📈' },
              { id: 'priority_team', label: 'Team & culture', icon: '👥' },
              { id: 'priority_systems', label: 'Systems & process', icon: '⚙️' },
              { id: 'priority_owner', label: 'Less owner-dependency', icon: '🎯' },
              { id: 'priority_exit', label: 'Exit readiness', icon: '🚪' },
            ].map((p) => (
              <label key={p.id} className={`flex items-center gap-2 p-3 border rounded-lg cursor-pointer ${targets[p.id] ? 'border-brand bg-brand-50' : 'border-border'}`}>
                <input type="checkbox" checked={!!targets[p.id]} onChange={(e) => update(p.id, e.target.checked)} />
                <span className="text-lg">{p.icon}</span>
                <span className="text-sm font-semibold">{p.label}</span>
              </label>
            ))}
          </div>
        </div>
        {baseline.profit && targets.years && targets.profit_multiple && (
          <div className="mt-5 p-3.5 bg-brand-50 rounded-lg">
            <div className="text-xs text-brand uppercase font-semibold">✨ Path analysis</div>
            <div className="text-sm mt-1">
              From <strong>£{baseline.profit.toLocaleString()}</strong> to <strong>£{(baseline.profit * targets.profit_multiple).toLocaleString()}</strong> in {targets.years} years requires <strong>{((Math.pow(targets.profit_multiple, 1 / targets.years) - 1) * 100).toFixed(1)}% CAGR</strong>.
            </div>
          </div>
        )}
      </div>
      <NavButtons onBack={onBack} onNext={onNext} />
    </>
  );
}

function ExitStrategy({ targets, update, onBack, onNext }: any) {
  const options = [
    { id: 'sell_dso', title: 'Sell to a DSO / corporate', desc: 'Maximise valuation, clean exit. 8-10× EBITDA.' },
    { id: 'sell_principal', title: 'Sell to a principal-led buyer', desc: 'Another dentist takes over. 3-4× ANP. Faster.' },
    { id: 'hire_ceo', title: 'Hire CEO and retain ownership', desc: 'Take dividend without daily ops. Long-term value.' },
    { id: 'semi_retire', title: 'Semi-retire (2-3 clinical days)', desc: 'Reduce hours, oversee strategy.' },
    { id: 'family', title: 'Pass to family', desc: 'Transition over 5-10 years. Tax planning critical.' },
    { id: 'unsure', title: 'Not sure yet', desc: 'Keep options open. We optimise for flexibility.' },
  ];
  return (
    <>
      <div className="card-padded mb-4">
        <h2 className="display text-xl font-semibold mb-1">The Endgame</h2>
        <p className="text-sm text-ink-muted mb-5">Knowing the exit shapes every decision today.</p>
        {options.map((o) => (
          <label key={o.id} className={`block p-4 border-2 rounded-xl mb-2.5 cursor-pointer ${targets.exit_strategy === o.id ? 'border-brand bg-brand-50' : 'border-border'}`}>
            <input type="radio" name="exit" checked={targets.exit_strategy === o.id} onChange={() => update('exit_strategy', o.id)} className="mr-2.5" />
            <strong>{o.title}</strong>
            <div className="text-xs text-ink-muted mt-1 ml-6">{o.desc}</div>
          </label>
        ))}
      </div>
      <NavButtons onBack={onBack} onNext={onNext} />
    </>
  );
}

function Review({ baseline, targets, onBack, onComplete }: any) {
  const { data: insights } = useQuery({
    queryKey: ['health-insights'],
    queryFn: () => api('/api/health/insights'),
  });
  const targetProfit = (baseline.profit || 0) * (targets.profit_multiple || 1);
  const cagr = targets.profit_multiple && targets.years
    ? ((Math.pow(targets.profit_multiple, 1 / targets.years) - 1) * 100).toFixed(1)
    : '—';
  return (
    <>
      <div className="card-padded text-white mb-4" style={{ background: 'linear-gradient(135deg, #0E7C7B, #085857)' }}>
        <h2 className="display text-3xl font-bold mb-2">✓ Your business health is captured</h2>
        <p className="opacity-90 mb-5">Every dashboard now reflects your data. Plan4Growth AI has analysed it.</p>
        <div className="grid grid-cols-4 gap-3.5">
          <div className="bg-white/10 p-3.5 rounded-lg">
            <div className="text-xs opacity-70 uppercase">Revenue today</div>
            <div className="display text-xl font-bold mt-1">£{(baseline.revenue || 0).toLocaleString()}</div>
          </div>
          <div className="bg-white/10 p-3.5 rounded-lg">
            <div className="text-xs opacity-70 uppercase">Profit today</div>
            <div className="display text-xl font-bold mt-1">£{(baseline.profit || 0).toLocaleString()}</div>
          </div>
          <div className="bg-white/10 p-3.5 rounded-lg border border-accent">
            <div className="text-xs opacity-70 uppercase">Target profit in {targets.years}y</div>
            <div className="display text-xl font-bold mt-1 text-accent">£{targetProfit.toLocaleString()}</div>
          </div>
          <div className="bg-white/10 p-3.5 rounded-lg">
            <div className="text-xs opacity-70 uppercase">Required CAGR</div>
            <div className="display text-xl font-bold mt-1">{cagr}%</div>
          </div>
        </div>
      </div>

      <div className="card-padded mb-4">
        <h3 className="display text-lg font-semibold mb-3">🤖 Plan4Growth AI's first read</h3>
        {!insights?.insights && <p className="text-sm text-ink-muted">Loading AI analysis…</p>}
        {insights?.insights?.map((ins: any, i: number) => {
          const colour = ins.severity === 'positive' ? 'border-success bg-green-50' :
                         ins.severity === 'warning' ? 'border-warning bg-orange-50' : 'border-danger bg-red-50';
          return (
            <div key={i} className={`p-3 mb-2 rounded-lg border-l-4 ${colour}`}>
              <div className="font-semibold text-sm">{ins.title}</div>
              <div className="text-xs mt-1">{ins.finding}</div>
              <div className="text-xs mt-1"><strong>Impact:</strong> {ins.impact}</div>
              <div className="text-xs mt-1"><strong>Action:</strong> {ins.action}</div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button onClick={onBack} className="btn-ghost">← Back</button>
        <button onClick={onComplete} className="btn-primary text-base">✓ Complete & open Progress Tracker</button>
      </div>
    </>
  );
}

function NavButtons({ onBack, onNext }: any) {
  return (
    <div className="flex justify-between gap-3">
      <button onClick={onBack} className="btn-ghost">← Back</button>
      <button onClick={onNext} className="btn-primary">Continue →</button>
    </div>
  );
}
