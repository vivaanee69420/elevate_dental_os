'use client';
// FIRE Plan — the owner's personal Exit Plan (DentaCFO gap Phase 4). Live model,
// no longer mock. Reads the assembled plan from GET /api/wealth/fire:
//   - business EV from the live valuation midpoint (or a manual override),
//   - the sale waterfall (debt → equity split → UK CGT w/ BADR → net cash),
//   - the FIRE projection: net worth vs the FIRE number (4% rule), path, and the
//     annual savings needed to get there.
// The FIRE + sale ASSUMPTIONS are editable here and persisted (PUT /inputs); the
// personal balance-sheet line-items (assets/liabilities) are edited on the Net
// Worth screen. Owner-only (rule 5). Money is integer pence; £ inputs convert at
// the edge.
import { useEffect, useState } from 'react';
import { formatPence } from '@/lib/format';
import { useWealthInputs, useExitPlan, useSaveWealthInputs } from '../wealth-hooks';
import type { FireSettings, SaleSettings } from '../wealth-api';

const THIS_YEAR = 2026;
const toPounds = (pence: number) => Math.round(pence / 100);
const toPence = (pounds: number) => Math.round(pounds * 100);

/** A labelled numeric field; value is held in the unit the caller passes. */
function NumField({
  label, value, onChange, suffix, step = 1,
}: {
  label: string; value: number; onChange: (n: number) => void; suffix?: string; step?: number;
}) {
  return (
    <label style={{ display: 'block', fontSize: 12 }}>
      <span className="text-ink-muted" style={{ display: 'block', marginBottom: 4 }}>{label}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input
          type="number"
          value={Number.isFinite(value) ? value : 0}
          step={step}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{
            width: '100%', padding: '7px 9px', border: '1px solid var(--border)',
            borderRadius: 8, fontSize: 13,
          }}
        />
        {suffix && <span className="text-ink-muted" style={{ fontSize: 12 }}>{suffix}</span>}
      </span>
    </label>
  );
}

export default function FirePlanScreen() {
  const inputs = useWealthInputs();
  const plan = useExitPlan();
  const save = useSaveWealthInputs();

  // Editable assumption drafts, seeded once the saved inputs arrive.
  const [fire, setFire] = useState<FireSettings | null>(null);
  const [sale, setSale] = useState<SaleSettings | null>(null);
  useEffect(() => {
    if (inputs.data && !fire) setFire(inputs.data.fire);
    if (inputs.data && !sale) setSale(inputs.data.sale);
  }, [inputs.data, fire, sale]);

  if (inputs.isLoading || plan.isLoading) {
    return <div className="text-ink-muted" style={{ padding: 24 }}>Loading FIRE plan…</div>;
  }
  if (inputs.error || plan.error || !plan.data) {
    return <div style={{ padding: 24, color: '#b91c1c' }}>Could not load the FIRE plan.</div>;
  }

  const p = plan.data;
  const f = p.fire;
  const w = p.waterfall;
  const multiple = f.withdrawalRatePct > 0 ? Math.round(100 / f.withdrawalRatePct) : 25;
  const cellLeft: React.CSSProperties = { padding: 8 };
  const cellRight: React.CSSProperties = { padding: 8, textAlign: 'right' };

  const onSave = () => {
    if (!fire || !sale) return;
    save.mutate({ fire, sale });
  };

  return (
    <div className="mx-auto" style={{ maxWidth: 1280 }}>
      <div className="mb-6" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <h1 className="display font-bold" style={{ fontSize: 28 }}>FIRE Plan</h1>
          <p className="text-ink-muted" style={{ fontSize: 13 }}>
            Financial Independence · Retire Early — your personal exit plan
          </p>
        </div>
        <button
          onClick={onSave}
          disabled={save.isPending || !fire || !sale}
          className="chip"
          style={{ padding: '8px 16px', fontWeight: 600, cursor: 'pointer', opacity: save.isPending ? 0.6 : 1 }}
        >
          {save.isPending ? 'Saving…' : 'Save assumptions'}
        </button>
      </div>

      {/* Hero banner */}
      <div
        className="card-padded"
        style={{
          background: 'linear-gradient(135deg, var(--brand) 0%, #085857 100%)',
          color: 'white', border: 'none', textAlign: 'center', marginBottom: 16,
        }}
      >
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr 1fr', gap: 24 }}>
          <div>
            <div style={{ fontSize: 11, opacity: 0.8, textTransform: 'uppercase' }}>Current net worth</div>
            <div className="display font-bold" style={{ fontSize: 32, margin: '6px 0' }}>
              {formatPence(f.currentNetWorthPence)}
            </div>
            <div style={{ fontSize: 11, opacity: 0.7 }}>incl. net sale proceeds</div>
          </div>
          <div style={{ borderLeft: '1px solid rgba(255,255,255,0.15)', borderRight: '1px solid rgba(255,255,255,0.15)' }}>
            <div style={{ fontSize: 11, opacity: 0.8, textTransform: 'uppercase' }}>FIRE number</div>
            <div className="display font-bold" style={{ fontSize: 32, margin: '6px 0', color: 'var(--accent)' }}>
              {formatPence(f.fireNumberPence)}
            </div>
            <div style={{ fontSize: 11, opacity: 0.7 }}>{multiple}× annual spend · {f.withdrawalRatePct}% rule</div>
          </div>
          <div>
            <div style={{ fontSize: 11, opacity: 0.8, textTransform: 'uppercase' }}>Years to FIRE</div>
            <div className="display font-bold" style={{ fontSize: 32, margin: '6px 0' }}>
              {f.yearsToFire == null ? '—' : f.yearsToFire}
            </div>
            <div style={{ fontSize: 11, opacity: 0.7 }}>
              {f.yearsToFire == null ? 'beyond 50 yrs at these inputs' : `by ${THIS_YEAR + f.yearsToFire}`}
            </div>
          </div>
        </div>
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.15)' }}>
          <div style={{ height: 14, background: 'rgba(255,255,255,0.15)', borderRadius: 7, overflow: 'hidden' }}>
            <div style={{ height: '100%', background: 'var(--accent)', width: `${Math.min(100, f.progressPct).toFixed(1)}%`, borderRadius: 7 }} />
          </div>
          <div style={{ fontSize: 12, marginTop: 8 }}>
            {f.progressPct.toFixed(1)}% of the way there ·{' '}
            {f.gapPence > 0 ? `${formatPence(f.gapPence)} to go` : 'target reached'}
          </div>
        </div>
      </div>

      {/* Path + sale waterfall */}
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <div className="card-padded">
          <h2 className="display font-bold" style={{ fontSize: 17, marginBottom: 4 }}>Path to FIRE</h2>
          <p className="text-ink-muted" style={{ fontSize: 12, marginBottom: 12 }}>
            Net worth growing at {f.growthRatePct}% + {formatPence(f.annualSavingsPence)}/yr saved.
            To hit the number by {THIS_YEAR + f.horizonYears} you need{' '}
            <strong>{formatPence(f.requiredAnnualSavingsPence)}/yr</strong>.
          </p>
          <table className="w-full" style={{ fontSize: 13 }}>
            <thead>
              <tr className="bg-bg">
                <th style={{ ...cellLeft, textAlign: 'left' }}>Year</th>
                <th style={cellRight}>Net worth</th>
              </tr>
            </thead>
            <tbody>
              {f.years.filter((r) => r.year > 0).map((r) => (
                <tr key={r.year}>
                  <td style={cellLeft}>
                    {THIS_YEAR + r.year}
                    {r.hitFire && <span className="chip chip-amber" style={{ marginLeft: 8 }}>FIRE</span>}
                  </td>
                  <td style={cellRight}>{formatPence(r.nwPence)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card-padded">
          <h2 className="display font-bold" style={{ fontSize: 17, marginBottom: 4 }}>Sale proceeds waterfall</h2>
          <p className="text-ink-muted" style={{ fontSize: 12, marginBottom: 12 }}>
            Business EV <strong>{formatPence(p.valuation.enterpriseValuePence)}</strong>{' '}
            <span className="chip" style={{ marginLeft: 4 }}>{p.valuation.source === 'live' ? 'live valuation' : 'manual'}</span>
          </p>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 13 }}>
            {([
              ['Equity value (after debt)', w.equityValuePence],
              [`Your share (${sale?.ownerSharePct ?? 100}%)`, w.ownerEquityProceedsPence],
              ['Chargeable gain', w.ownerGainPence],
              [`CGT (${w.effectiveCgtPct}% eff.)`, -w.cgtPence],
              ['Freehold equity', w.freeholdEquityPence],
            ] as [string, number][]).map(([label, val]) => (
              <li key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
                <span className="text-ink-muted">{label}</span>
                <span>{formatPence(val)}</span>
              </li>
            ))}
            <li style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', fontWeight: 700 }}>
              <span>Net cash to you</span>
              <span>{formatPence(w.totalNetProceedsPence)}</span>
            </li>
          </ul>
          <p className="text-ink-muted" style={{ fontSize: 11, marginTop: 8 }}>
            CGT: Business Asset Disposal Relief at 18% to the £1m lifetime cap, 24% above. Freehold treated as already net of its mortgage/tax.
          </p>
        </div>
      </div>

      {/* Editable assumptions */}
      {fire && sale && (
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div className="card-padded">
            <h2 className="display font-bold" style={{ fontSize: 17, marginBottom: 12 }}>FIRE assumptions</h2>
            <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <NumField label="Target annual spend (£)" value={toPounds(fire.targetAnnualSpendPence)} step={1000}
                onChange={(n) => setFire({ ...fire, targetAnnualSpendPence: toPence(n) })} />
              <NumField label="Withdrawal rate" suffix="%" value={fire.withdrawalRatePct} step={0.5}
                onChange={(n) => setFire({ ...fire, withdrawalRatePct: n })} />
              <NumField label="Net growth rate" suffix="%" value={fire.growthRatePct} step={0.5}
                onChange={(n) => setFire({ ...fire, growthRatePct: n })} />
              <NumField label="Annual savings (£)" value={toPounds(fire.annualSavingsPence)} step={1000}
                onChange={(n) => setFire({ ...fire, annualSavingsPence: toPence(n) })} />
              <NumField label="Horizon" suffix="yrs" value={fire.horizonYears}
                onChange={(n) => setFire({ ...fire, horizonYears: n })} />
            </div>
          </div>

          <div className="card-padded">
            <h2 className="display font-bold" style={{ fontSize: 17, marginBottom: 12 }}>Sale assumptions</h2>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 12 }}>
              <input type="checkbox" checked={sale.useLiveValuation}
                onChange={(e) => setSale({ ...sale, useLiveValuation: e.target.checked })} />
              Use the live valuation midpoint for business EV
            </label>
            <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {!sale.useLiveValuation && (
                <NumField label="Business EV (£)" value={toPounds(sale.enterpriseValuePence)} step={50000}
                  onChange={(n) => setSale({ ...sale, enterpriseValuePence: toPence(n) })} />
              )}
              <NumField label="Your equity share" suffix="%" value={sale.ownerSharePct}
                onChange={(n) => setSale({ ...sale, ownerSharePct: n })} />
              <NumField label="Business debt (£)" value={toPounds(sale.businessDebtPence)} step={10000}
                onChange={(n) => setSale({ ...sale, businessDebtPence: toPence(n) })} />
              <NumField label="Acquisition base cost (£)" value={toPounds(sale.acquisitionCostPence)} step={10000}
                onChange={(n) => setSale({ ...sale, acquisitionCostPence: toPence(n) })} />
              <NumField label="Freehold equity (£)" value={toPounds(sale.freeholdEquityPence)} step={10000}
                onChange={(n) => setSale({ ...sale, freeholdEquityPence: toPence(n) })} />
              <NumField label="BADR allowance used (£)" value={toPounds(sale.badrLifetimeUsedPence)} step={10000}
                onChange={(n) => setSale({ ...sale, badrLifetimeUsedPence: toPence(n) })} />
            </div>
          </div>
        </div>
      )}
      {save.isError && <p style={{ color: '#b91c1c', fontSize: 12, marginTop: 8 }}>Save failed: {String(save.error?.message ?? '')}</p>}
    </div>
  );
}
