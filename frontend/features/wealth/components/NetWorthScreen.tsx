'use client';
// Net Worth — personal balance sheet (DentaCFO gap Phase 4). Live + editable,
// no longer mock. Reads totals from GET /api/wealth/net and edits the asset /
// liability line-items, persisted via PUT /api/wealth/inputs (the rest of the
// saved blob — pensions/properties/fire/sale — is round-tripped untouched).
// `liquid` marks an asset as drawdown-able toward FIRE (residence = not liquid;
// business equity is always excluded from the FIRE pool — its realisable value
// comes from the sale waterfall on the FIRE screen). Owner-only (rule 5). Money
// is integer pence; £ inputs convert at the edge.
import { useEffect, useState } from 'react';
import { formatPence } from '@/lib/format';
import { useWealthInputs, useNetWorth, useSaveWealthInputs } from '../wealth-hooks';
import type { WealthAsset, WealthLiability, AssetType } from '../wealth-api';

const ASSET_TYPES: AssetType[] = ['Business', 'Property', 'Pension', 'Investments', 'Cash'];
const toPounds = (pence: number) => Math.round(pence / 100);
const toPence = (pounds: number) => Math.round(pounds * 100);
const sumPence = (rows: { valuePence: number }[]) => rows.reduce((s, r) => s + Math.round(r.valuePence || 0), 0);

const cellInput: React.CSSProperties = {
  padding: '5px 7px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, width: '100%',
};

export default function NetWorthScreen() {
  const inputs = useWealthInputs();
  const net = useNetWorth();
  const save = useSaveWealthInputs();

  const [assets, setAssets] = useState<WealthAsset[] | null>(null);
  const [liabilities, setLiabilities] = useState<WealthLiability[] | null>(null);
  useEffect(() => {
    if (inputs.data && !assets) setAssets(inputs.data.assets);
    if (inputs.data && !liabilities) setLiabilities(inputs.data.liabilities);
  }, [inputs.data, assets, liabilities]);

  if (inputs.isLoading || net.isLoading) {
    return <div className="text-ink-muted" style={{ padding: 24 }}>Loading net worth…</div>;
  }
  if (inputs.error || net.error || !assets || !liabilities) {
    return <div style={{ padding: 24, color: '#b91c1c' }}>Could not load the balance sheet.</div>;
  }

  const totalAssets = sumPence(assets);
  const totalLiab = sumPence(liabilities);
  const netWorth = totalAssets - totalLiab;

  const onSave = () => {
    if (!inputs.data) return;
    save.mutate({
      assets, liabilities,
      pensions: inputs.data.pensions,
      properties: inputs.data.properties,
      exit: inputs.data.exit,
    });
  };

  const setAsset = (i: number, patch: Partial<WealthAsset>) =>
    setAssets(assets.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  const setLiab = (i: number, patch: Partial<WealthLiability>) =>
    setLiabilities(liabilities.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <div className="mx-auto" style={{ maxWidth: 1280 }}>
      <div className="mb-6" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <h1 className="display font-bold" style={{ fontSize: 28 }}>Net Worth</h1>
          <p className="text-ink-muted" style={{ fontSize: 13 }}>
            Personal balance sheet across business, property, pensions, and investments
          </p>
        </div>
        <button
          onClick={onSave}
          disabled={save.isPending}
          className="chip"
          style={{ padding: '8px 16px', fontWeight: 600, cursor: 'pointer', opacity: save.isPending ? 0.6 : 1 }}
        >
          {save.isPending ? 'Saving…' : 'Save balance sheet'}
        </button>
      </div>

      {/* Hero net-worth banner */}
      <div
        className="card-padded"
        style={{
          background: 'linear-gradient(135deg, var(--brand) 0%, #085857 100%)',
          color: 'white', border: 'none', textAlign: 'center', marginBottom: 16,
        }}
      >
        <div style={{ fontSize: 11, opacity: 0.8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Total net worth
        </div>
        <div className="display font-bold" style={{ fontSize: 56, margin: '8px 0' }}>
          {formatPence(netWorth)}
        </div>
        <div className="flex justify-center" style={{ gap: 24, fontSize: 13 }}>
          <div><span style={{ opacity: 0.7 }}>Assets:</span> {formatPence(totalAssets)}</div>
          <div><span style={{ opacity: 0.7 }}>Liabilities:</span> {formatPence(totalLiab)}</div>
        </div>
      </div>

      {/* Assets / Liabilities editors */}
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Assets */}
        <div className="card-padded">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h2 className="display font-bold" style={{ fontSize: 17 }}>Assets</h2>
            <button className="chip" style={{ cursor: 'pointer', fontSize: 12 }}
              onClick={() => setAssets([...assets, { name: '', valuePence: 0, type: 'Investments', growthPct: 0, liquid: true }])}>
              + Add
            </button>
          </div>
          <table className="w-full" style={{ fontSize: 12 }}>
            <thead>
              <tr className="text-ink-muted bg-bg" style={{ textAlign: 'left' }}>
                <th style={{ padding: 6 }}>Name</th>
                <th style={{ padding: 6 }}>Type</th>
                <th style={{ padding: 6, textAlign: 'right' }}>Value (£)</th>
                <th style={{ padding: 6 }}>Liquid</th>
                <th style={{ padding: 6 }} />
              </tr>
            </thead>
            <tbody>
              {assets.map((a, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: 6 }}>
                    <input style={cellInput} value={a.name} placeholder="Asset"
                      onChange={(e) => setAsset(i, { name: e.target.value })} />
                  </td>
                  <td style={{ padding: 6 }}>
                    <select style={cellInput} value={a.type}
                      onChange={(e) => setAsset(i, { type: e.target.value as AssetType })}>
                      {ASSET_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: 6, textAlign: 'right' }}>
                    <input style={{ ...cellInput, textAlign: 'right' }} type="number" step={1000} value={toPounds(a.valuePence)}
                      onChange={(e) => setAsset(i, { valuePence: toPence(Number(e.target.value)) })} />
                  </td>
                  <td style={{ padding: 6, textAlign: 'center' }}>
                    <input type="checkbox" checked={a.liquid} disabled={a.type === 'Business'}
                      onChange={(e) => setAsset(i, { liquid: e.target.checked })} />
                  </td>
                  <td style={{ padding: 6 }}>
                    <button className="text-ink-muted" style={{ cursor: 'pointer', border: 'none', background: 'none' }}
                      onClick={() => setAssets(assets.filter((_, j) => j !== i))}>Remove</button>
                  </td>
                </tr>
              ))}
              <tr style={{ fontWeight: 700 }}>
                <td style={{ padding: '12px 6px' }} colSpan={2}>Total assets</td>
                <td className="text-right text-success" style={{ padding: '12px 6px' }}>{formatPence(totalAssets)}</td>
                <td colSpan={2} />
              </tr>
            </tbody>
          </table>
          <p className="text-ink-muted" style={{ fontSize: 11, marginTop: 8 }}>
            Untick “Liquid” for assets you won’t draw down (e.g. your home). Business equity is never counted in the FIRE pool — its sale value comes from the Exit Plan waterfall.
          </p>
        </div>

        {/* Liabilities */}
        <div className="card-padded">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h2 className="display font-bold" style={{ fontSize: 17 }}>Liabilities</h2>
            <button className="chip" style={{ cursor: 'pointer', fontSize: 12 }}
              onClick={() => setLiabilities([...liabilities, { name: '', valuePence: 0, ratePct: 0 }])}>
              + Add
            </button>
          </div>
          <table className="w-full" style={{ fontSize: 12 }}>
            <thead>
              <tr className="text-ink-muted bg-bg" style={{ textAlign: 'left' }}>
                <th style={{ padding: 6 }}>Name</th>
                <th style={{ padding: 6, textAlign: 'right' }}>Rate %</th>
                <th style={{ padding: 6, textAlign: 'right' }}>Value (£)</th>
                <th style={{ padding: 6 }} />
              </tr>
            </thead>
            <tbody>
              {liabilities.map((l, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: 6 }}>
                    <input style={cellInput} value={l.name} placeholder="Liability"
                      onChange={(e) => setLiab(i, { name: e.target.value })} />
                  </td>
                  <td style={{ padding: 6, textAlign: 'right' }}>
                    <input style={{ ...cellInput, textAlign: 'right' }} type="number" step={0.1} value={l.ratePct}
                      onChange={(e) => setLiab(i, { ratePct: Number(e.target.value) })} />
                  </td>
                  <td style={{ padding: 6, textAlign: 'right' }}>
                    <input style={{ ...cellInput, textAlign: 'right' }} type="number" step={1000} value={toPounds(l.valuePence)}
                      onChange={(e) => setLiab(i, { valuePence: toPence(Number(e.target.value)) })} />
                  </td>
                  <td style={{ padding: 6 }}>
                    <button className="text-ink-muted" style={{ cursor: 'pointer', border: 'none', background: 'none' }}
                      onClick={() => setLiabilities(liabilities.filter((_, j) => j !== i))}>Remove</button>
                  </td>
                </tr>
              ))}
              <tr style={{ fontWeight: 700 }}>
                <td style={{ padding: '12px 6px' }}>Total liabilities</td>
                <td />
                <td className="text-right text-danger" style={{ padding: '12px 6px' }}>{formatPence(totalLiab)}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      {save.isError && <p style={{ color: '#b91c1c', fontSize: 12, marginTop: 8 }}>Save failed: {String(save.error?.message ?? '')}</p>}
    </div>
  );
}
