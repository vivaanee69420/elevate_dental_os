'use client';
// Pensions — DentaCFO gap Phase 4. Live + editable, no longer mock. Reads/writes
// the persisted pension schemes (wealth_inputs.pensions) via the wealth inputs
// API; the pension balances also seed "existing investments" on the Exit Plan.
// Owner-only (rule 5). Money is integer pence; £ inputs convert at the edge.
import { useEffect, useState } from 'react';
import { formatPence } from '@/lib/format';
import { useWealthInputs, useSaveWealthInputs } from '../wealth-hooks';
import type { WealthPension } from '../wealth-api';

const PENSION_TYPES: WealthPension['type'][] = ['SIPP', 'NHS', 'Director'];
const ANNUAL_ALLOWANCE_PENCE = 60_000_00; // 2025/26 annual allowance
const toPounds = (pence: number) => Math.round(pence / 100);
const toPence = (pounds: number) => Math.round(pounds * 100);
const sum = (rows: WealthPension[], k: 'balancePence' | 'contributionsYtdPence') =>
  rows.reduce((s, r) => s + Math.round(r[k] || 0), 0);

const cellInput: React.CSSProperties = {
  padding: '5px 7px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, width: '100%',
};

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card-padded">
      <div className="text-ink-muted font-bold uppercase" style={{ fontSize: 11, letterSpacing: '0.05em' }}>{label}</div>
      <div className="display font-bold" style={{ fontSize: 28, marginTop: 4 }}>{value}</div>
      {sub && <div className="font-bold text-success" style={{ fontSize: 12, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

export default function PensionsScreen() {
  const inputs = useWealthInputs();
  const save = useSaveWealthInputs();
  const [pensions, setPensions] = useState<WealthPension[] | null>(null);

  useEffect(() => {
    if (inputs.data && !pensions) setPensions(inputs.data.pensions);
  }, [inputs.data, pensions]);

  if (inputs.isLoading) return <div className="text-ink-muted" style={{ padding: 24 }}>Loading pensions…</div>;
  if (inputs.error || !pensions || !inputs.data) return <div style={{ padding: 24, color: '#b91c1c' }}>Could not load pensions.</div>;

  const total = sum(pensions, 'balancePence');
  const contributions = sum(pensions, 'contributionsYtdPence');
  const projected65 = Math.round(total * Math.pow(1.07, 20));
  const allowanceLeft = ANNUAL_ALLOWANCE_PENCE - contributions;

  const setRow = (i: number, patch: Partial<WealthPension>) =>
    setPensions(pensions.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const onSave = () => save.mutate({
    pensions, assets: inputs.data!.assets, liabilities: inputs.data!.liabilities,
    properties: inputs.data!.properties, exit: inputs.data!.exit,
  });

  return (
    <div className="mx-auto" style={{ maxWidth: 1280 }}>
      <div className="mb-6" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <h1 className="display font-bold" style={{ fontSize: 28 }}>Pensions</h1>
          <p className="text-ink-muted" style={{ fontSize: 13 }}>SIPP · NHS · Director pension tracking</p>
        </div>
        <button onClick={onSave} disabled={save.isPending} className="chip"
          style={{ padding: '8px 16px', fontWeight: 600, cursor: 'pointer', opacity: save.isPending ? 0.6 : 1 }}>
          {save.isPending ? 'Saving…' : 'Save pensions'}
        </button>
      </div>

      <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <Kpi label="Total pension pot" value={formatPence(total)} />
        <Kpi label="Contributions YTD" value={formatPence(contributions)} sub={`${((contributions / ANNUAL_ALLOWANCE_PENCE) * 100).toFixed(0)}% of allowance`} />
        <Kpi label="Annual allowance left" value={formatPence(Math.max(0, allowanceLeft))} />
        <Kpi label="Projected at 65" value={formatPence(projected65)} sub="7% growth assumption" />
      </div>

      <div className="card-padded">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 className="display font-bold" style={{ fontSize: 17 }}>Pension breakdown</h2>
          <button className="chip" style={{ cursor: 'pointer', fontSize: 12 }}
            onClick={() => setPensions([...pensions, { name: '', balancePence: 0, contributionsYtdPence: 0, type: 'SIPP' }])}>
            + Add scheme
          </button>
        </div>
        <table className="w-full" style={{ fontSize: 12 }}>
          <thead>
            <tr className="text-ink-muted bg-bg" style={{ textAlign: 'left' }}>
              <th style={{ padding: 6 }}>Scheme</th>
              <th style={{ padding: 6 }}>Type</th>
              <th style={{ padding: 6, textAlign: 'right' }}>Balance (£)</th>
              <th style={{ padding: 6, textAlign: 'right' }}>Contributions YTD (£)</th>
              <th style={{ padding: 6, textAlign: 'right' }}>% of pot</th>
              <th style={{ padding: 6 }} />
            </tr>
          </thead>
          <tbody>
            {pensions.map((p, i) => (
              <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: 6 }}>
                  <input style={cellInput} value={p.name} placeholder="Scheme"
                    onChange={(e) => setRow(i, { name: e.target.value })} />
                </td>
                <td style={{ padding: 6 }}>
                  <select style={cellInput} value={p.type} onChange={(e) => setRow(i, { type: e.target.value as WealthPension['type'] })}>
                    {PENSION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </td>
                <td style={{ padding: 6, textAlign: 'right' }}>
                  <input style={{ ...cellInput, textAlign: 'right' }} type="number" step={1000} value={toPounds(p.balancePence)}
                    onChange={(e) => setRow(i, { balancePence: toPence(Number(e.target.value)) })} />
                </td>
                <td style={{ padding: 6, textAlign: 'right' }}>
                  <input style={{ ...cellInput, textAlign: 'right' }} type="number" step={500} value={toPounds(p.contributionsYtdPence)}
                    onChange={(e) => setRow(i, { contributionsYtdPence: toPence(Number(e.target.value)) })} />
                </td>
                <td style={{ padding: 6, textAlign: 'right' }}>{total > 0 ? ((p.balancePence / total) * 100).toFixed(1) : '0.0'}%</td>
                <td style={{ padding: 6 }}>
                  <button className="text-ink-muted" style={{ cursor: 'pointer', border: 'none', background: 'none' }}
                    onClick={() => setPensions(pensions.filter((_, j) => j !== i))}>Remove</button>
                </td>
              </tr>
            ))}
            {pensions.length === 0 && (
              <tr><td colSpan={6} className="text-ink-muted" style={{ padding: 16, textAlign: 'center' }}>No pension schemes yet — add one.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {save.isError && <p style={{ color: '#b91c1c', fontSize: 12, marginTop: 8 }}>Save failed: {String(save.error?.message ?? '')}</p>}
    </div>
  );
}
