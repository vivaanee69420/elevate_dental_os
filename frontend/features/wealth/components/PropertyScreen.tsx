'use client';
// Property Portfolio — DentaCFO gap Phase 4. Live + editable, no longer mock.
// Reads/writes the persisted property portfolio (wealth_inputs.properties) via
// the wealth inputs API; buy-to-let equity + rent seed the Exit Plan freeholds.
// Owner-only (rule 5). Money is integer pence; £ inputs convert at the edge.
import { useEffect, useState } from 'react';
import { formatPence } from '@/lib/format';
import { useWealthInputs, useSaveWealthInputs } from '../wealth-hooks';
import type { WealthProperty } from '../wealth-api';

const PROPERTY_TYPES: WealthProperty['type'][] = ['Residential', 'Buy-to-let'];
const toPounds = (pence: number) => Math.round(pence / 100);
const toPence = (pounds: number) => Math.round(pounds * 100);

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

export default function PropertyScreen() {
  const inputs = useWealthInputs();
  const save = useSaveWealthInputs();
  const [properties, setProperties] = useState<WealthProperty[] | null>(null);

  useEffect(() => {
    if (inputs.data && !properties) setProperties(inputs.data.properties);
  }, [inputs.data, properties]);

  if (inputs.isLoading) return <div className="text-ink-muted" style={{ padding: 24 }}>Loading properties…</div>;
  if (inputs.error || !properties || !inputs.data) return <div style={{ padding: 24, color: '#b91c1c' }}>Could not load the property portfolio.</div>;

  const totalValue = properties.reduce((s, p) => s + Math.round(p.valuePence || 0), 0);
  const totalMortgage = properties.reduce((s, p) => s + Math.round(p.mortgagePence || 0), 0);
  const totalEquity = totalValue - totalMortgage;
  const monthlyRental = properties.reduce((s, p) => s + Math.round(p.monthlyIncomePence || 0), 0);

  const setRow = (i: number, patch: Partial<WealthProperty>) =>
    setProperties(properties.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const onSave = () => save.mutate({
    properties, assets: inputs.data!.assets, liabilities: inputs.data!.liabilities,
    pensions: inputs.data!.pensions, exit: inputs.data!.exit,
  });

  return (
    <div className="mx-auto" style={{ maxWidth: 1280 }}>
      <div className="mb-6" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <h1 className="display font-bold" style={{ fontSize: 28 }}>Property Portfolio</h1>
          <p className="text-ink-muted" style={{ fontSize: 13 }}>{properties.length} properties · {formatPence(totalEquity)} equity</p>
        </div>
        <button onClick={onSave} disabled={save.isPending} className="chip"
          style={{ padding: '8px 16px', fontWeight: 600, cursor: 'pointer', opacity: save.isPending ? 0.6 : 1 }}>
          {save.isPending ? 'Saving…' : 'Save properties'}
        </button>
      </div>

      <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <Kpi label="Portfolio value" value={formatPence(totalValue)} />
        <Kpi label="Total mortgages" value={formatPence(totalMortgage)} />
        <Kpi label="Net equity" value={formatPence(totalEquity)} sub={totalValue > 0 ? `${((totalEquity / totalValue) * 100).toFixed(0)}% equity` : undefined} />
        <Kpi label="Monthly rental" value={formatPence(monthlyRental)} />
      </div>

      <div className="card-padded">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 className="display font-bold" style={{ fontSize: 17 }}>Properties</h2>
          <button className="chip" style={{ cursor: 'pointer', fontSize: 12 }}
            onClick={() => setProperties([...properties, { name: '', address: '', valuePence: 0, mortgagePence: 0, monthlyIncomePence: 0, monthlyCostPence: 0, yieldPct: null, type: 'Buy-to-let' }])}>
            + Add property
          </button>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="w-full" style={{ fontSize: 12, minWidth: 720 }}>
            <thead>
              <tr className="text-ink-muted bg-bg" style={{ textAlign: 'left' }}>
                <th style={{ padding: 6 }}>Name</th>
                <th style={{ padding: 6 }}>Type</th>
                <th style={{ padding: 6, textAlign: 'right' }}>Value (£)</th>
                <th style={{ padding: 6, textAlign: 'right' }}>Mortgage (£)</th>
                <th style={{ padding: 6, textAlign: 'right' }}>Equity</th>
                <th style={{ padding: 6, textAlign: 'right' }}>Rent (£/mo)</th>
                <th style={{ padding: 6 }} />
              </tr>
            </thead>
            <tbody>
              {properties.map((p, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: 6 }}>
                    <input style={cellInput} value={p.name} placeholder="Property"
                      onChange={(e) => setRow(i, { name: e.target.value })} />
                  </td>
                  <td style={{ padding: 6 }}>
                    <select style={cellInput} value={p.type} onChange={(e) => setRow(i, { type: e.target.value as WealthProperty['type'] })}>
                      {PROPERTY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: 6, textAlign: 'right' }}>
                    <input style={{ ...cellInput, textAlign: 'right' }} type="number" step={10000} value={toPounds(p.valuePence)}
                      onChange={(e) => setRow(i, { valuePence: toPence(Number(e.target.value)) })} />
                  </td>
                  <td style={{ padding: 6, textAlign: 'right' }}>
                    <input style={{ ...cellInput, textAlign: 'right' }} type="number" step={10000} value={toPounds(p.mortgagePence)}
                      onChange={(e) => setRow(i, { mortgagePence: toPence(Number(e.target.value)) })} />
                  </td>
                  <td className="text-success" style={{ padding: 6, textAlign: 'right', fontWeight: 600 }}>
                    {formatPence(Math.round(p.valuePence || 0) - Math.round(p.mortgagePence || 0))}
                  </td>
                  <td style={{ padding: 6, textAlign: 'right' }}>
                    <input style={{ ...cellInput, textAlign: 'right' }} type="number" step={100} value={toPounds(p.monthlyIncomePence)}
                      onChange={(e) => setRow(i, { monthlyIncomePence: toPence(Number(e.target.value)) })} />
                  </td>
                  <td style={{ padding: 6 }}>
                    <button className="text-ink-muted" style={{ cursor: 'pointer', border: 'none', background: 'none' }}
                      onClick={() => setProperties(properties.filter((_, j) => j !== i))}>Remove</button>
                  </td>
                </tr>
              ))}
              {properties.length === 0 && (
                <tr><td colSpan={7} className="text-ink-muted" style={{ padding: 16, textAlign: 'center' }}>No properties yet — add one.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-ink-muted" style={{ fontSize: 11, marginTop: 8 }}>
          Buy-to-let equity (value − mortgage) and annualised rent seed the freeholds on your Exit Plan.
        </p>
      </div>
      {save.isError && <p style={{ color: '#b91c1c', fontSize: 12, marginTop: 8 }}>Save failed: {String(save.error?.message ?? '')}</p>}
    </div>
  );
}
