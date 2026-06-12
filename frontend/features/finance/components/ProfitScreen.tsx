'use client';
// Profit & Loss — QuickBooks-style matrix. Line items (rows) × time-period
// columns (Total/Month/Quarter/Year) driven by QbFilterBar, with optional
// %-of-income, previous-period and previous-year comparison. Real data from
// GET /api/analytics/finance-series (settled-cash revenue + monthly_financials
// costs, per accounting basis + QBO company). Money in pounds at this layer.
import { useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { Skeleton } from '@/components/ui';
import { poundsCompact, monthShort } from '../mock';
import { useFinanceSeries, useQuickbooksAccounts } from '../hooks';
import FinanceToolbar from './FinanceToolbar';
import ManualPLModal from './ManualPLModal';
import PracticeTabs from '@/features/practices/PracticeTabs';
import QbFilterBar, { DEFAULT_QB_FILTERS, type QbFilters } from './QbFilterBar';
import {
  PL_LINES, buildColumns, totalColumn, pctOfIncome, sliceMonths, shiftYM,
  type MatrixColumn, type LineKey,
} from '../pl-matrix';
import type { FinanceMonth } from '../api';

const BASIS_LABEL: Record<string, string> = {
  actuals: 'real actuals (Xero / QuickBooks / manual)',
  mixed: 'real costs where entered, £0 elsewhere',
  'revenue-only': 'real revenue (settled payments) · costs/profit £0 until a cost source connects',
};
const BRAND = 'var(--brand)';
const ACCENT = 'var(--accent)';

const pad = (n: number) => String(n).padStart(2, '0');
function ym(d: Date): string { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; }

// The in-scope month window [from,to] (YYYY-MM) for the chosen report period.
function scopeWindow(range: QbFilters['range'], ref = new Date()): { from: string; to: string } {
  if (range.from && range.to) return { from: range.from.slice(0, 7), to: range.to.slice(0, 7) };
  const to = ym(ref);
  const from = ym(new Date(ref.getFullYear(), ref.getMonth() - 11, 1));
  return { from, to };
}
// Count of months in [from,to] inclusive.
function monthSpan(from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  return (ty * 12 + tm) - (fy * 12 + fm) + 1;
}

function Kpi({ label, value, delta }: { label: string; value: string; delta?: string }) {
  return (
    <div className="card-padded">
      <div className="text-xs text-ink-muted uppercase">{label}</div>
      <div className="display text-2xl font-bold mt-1">{value}</div>
      {delta && <div className="text-xs font-semibold mt-1" style={{ color: 'var(--success)' }}>{delta}</div>}
    </div>
  );
}

export default function ProfitScreen() {
  const [practiceId, setPracticeId] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [filters, setFilters] = useState<QbFilters>(DEFAULT_QB_FILTERS);
  const [plModalOpen, setPlModalOpen] = useState(false);
  const { data: qbAccounts } = useQuickbooksAccounts();

  // Fetch window: wide enough for the requested comparison columns, capped at 24mo.
  const scope = useMemo(() => scopeWindow(filters.range), [filters.range]);
  const spanMonths = monthSpan(scope.from, scope.to);
  const fetchMonths = useMemo(() => {
    let m = spanMonths;
    if (filters.compare.prevYear) m = spanMonths + 12;
    else if (filters.compare.prevPeriod) m = spanMonths * 2;
    return Math.min(24, Math.max(1, m));
  }, [spanMonths, filters.compare.prevYear, filters.compare.prevPeriod]);

  // Always fetch by month-count ending now; slice locally. (range.from in the past
  // beyond 24mo is out of scope — the matrix shows what the window covers.)
  const { data, isLoading, isError } = useFinanceSeries(practiceId, null, {
    months: fetchMonths,
    accountingMethod: filters.method,
    integrationAccountId: companyId,
  });

  const allMonths: FinanceMonth[] = data?.months ?? [];
  const basisLabel = BASIS_LABEL[data?.basis ?? 'revenue-only'] ?? BASIS_LABEL['revenue-only'];

  // In-scope months + the pivoted columns.
  const scopeMonths = useMemo(() => sliceMonths(allMonths, scope.from, scope.to), [allMonths, scope.from, scope.to]);
  const columns = useMemo(() => buildColumns(scopeMonths, filters.groupBy), [scopeMonths, filters.groupBy]);

  // Comparison total columns (appended after the period columns).
  const compareCols = useMemo(() => {
    const out: MatrixColumn[] = [];
    if (filters.compare.prevPeriod) {
      const pf = shiftYM(scope.from, -spanMonths);
      const pt = shiftYM(scope.to, -spanMonths);
      out.push(totalColumn(sliceMonths(allMonths, pf, pt), 'prev-period', 'Prev period'));
    }
    if (filters.compare.prevYear) {
      const pf = shiftYM(scope.from, -12);
      const pt = shiftYM(scope.to, -12);
      out.push(totalColumn(sliceMonths(allMonths, pf, pt), 'prev-year', 'Prev year'));
    }
    return out;
  }, [allMonths, scope.from, scope.to, spanMonths, filters.compare.prevPeriod, filters.compare.prevYear]);

  const renderCols = [...columns, ...compareCols];
  const costsAvailable = scopeMonths.some((m) => m.costsAvailable);
  const hasRevenue = scopeMonths.some((m) => m.revenue > 0);
  const grand = useMemo(() => totalColumn(scopeMonths, 'grand', 'Total'), [scopeMonths]);

  // KPI strip (always over the in-scope window).
  const revenueMonths = scopeMonths.filter((m) => m.revenue > 0).length;
  const avgMonthlyRevenue = revenueMonths > 0 ? Math.round(grand.values.revenue / revenueMonths) : 0;

  const chartData = scopeMonths.map((m) => ({ month: monthShort(m.month), Revenue: m.revenue, Profit: m.profit }));

  const fmtCell = (v: number, real: boolean) => (real ? poundsCompact(v) : '—');
  const pctCells = filters.compare.pctOfIncome ? renderCols.map((c) => pctOfIncome(c)) : null;

  function exportPdf() {
    const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string);
    const head = `<tr><th>Line</th>${renderCols.map((c) => `<th class=r>${esc(c.label)}</th>`).join('')}</tr>`;
    const lineRow = (key: LineKey, label: string) => `<tr><td>${label}</td>${renderCols
      .map((c) => `<td class=r>${costsAvailable || key === 'revenue' ? poundsCompact(c.values[key]) : '—'}</td>`).join('')}</tr>`;
    const body = PL_LINES.map((l) => lineRow(l.key, l.label)).join('');
    const profitRow = `<tr class=tot><td>Net profit</td>${renderCols
      .map((c) => `<td class=r>${costsAvailable ? poundsCompact(c.profit) : '—'}</td>`).join('')}</tr>`;
    const marginRow = `<tr><td>Margin %</td>${renderCols
      .map((c) => `<td class=r>${c.marginPct == null ? '—' : c.marginPct.toFixed(1) + '%'}</td>`).join('')}</tr>`;
    const html = `<!doctype html><html><head><meta charset=utf-8><title>P&L</title><style>body{font:13px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#1F2937;margin:32px}h1{font-size:20px;margin:0}.sub{color:#6B7280;font-size:11px;margin:4px 0 18px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{padding:7px 10px;border-bottom:1px solid #E5E7EB;text-align:left}.r{text-align:right}.tot td{font-weight:700;border-top:2px solid #1F2937}@media print{body{margin:14mm}}</style></head><body><h1>Profit &amp; Loss</h1><div class=sub>${esc(filters.method)} basis · ${esc(basisLabel)} · ${esc(new Date().toLocaleString('en-GB'))}</div><table><thead>${head}</thead><tbody>${body}${profitRow}${marginRow}</tbody></table></body></html>`;
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(html); w.document.close(); w.focus();
    w.onload = () => w.print();
    setTimeout(() => { try { w.print(); } catch { /* closed */ } }, 400);
  }

  const cellPad = '10px 14px';
  return (
    <div className="container max-w-7xl mx-auto">
      <div className="mb-6 flex justify-between items-start gap-4 flex-wrap">
        <div>
          <h1 className="display text-3xl font-bold">Profit &amp; Loss</h1>
          <p className="text-sm text-ink-muted">{filters.method === 'cash' ? 'Cash' : 'Accrual'} basis · {basisLabel}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={() => setPlModalOpen(true)} className="font-semibold"
            style={{ padding: '9px 16px', fontSize: 13, border: 'none', borderRadius: 6, background: 'var(--brand)', color: 'white', cursor: 'pointer' }}>
            Enter actuals
          </button>
          <button type="button" onClick={exportPdf} disabled={renderCols.length === 0} className="font-semibold"
            style={{ padding: '9px 16px', fontSize: 13, border: '1px solid var(--border)', borderRadius: 6, background: 'white', opacity: renderCols.length ? 1 : 0.5, cursor: renderCols.length ? 'pointer' : 'default' }}>
            Export to PDF
          </button>
        </div>
      </div>

      <ManualPLModal open={plModalOpen} onClose={() => setPlModalOpen(false)} practiceId={practiceId} />

      <PracticeTabs value={practiceId} onChange={setPracticeId} />

      {(qbAccounts?.length ?? 0) > 0 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase' }}>QuickBooks company</span>
          <select value={companyId ?? ''} onChange={(e) => setCompanyId(e.target.value || null)}
            style={{ padding: '5px 8px', fontSize: 12, border: '1px solid var(--border)', borderRadius: 6 }}>
            <option value="">All companies</option>
            {qbAccounts!.map((a) => (
              <option key={a.id} value={a.id}>{a.company_name || a.label || a.id.slice(0, 8)}</option>
            ))}
          </select>
        </div>
      )}

      <QbFilterBar value={filters} onChange={setFilters} />
      <FinanceToolbar />

      {isError && (
        <div className="card-padded mb-4">
          <div className="font-semibold">Could not load P&amp;L</div>
          <div className="text-sm text-ink-muted">The analytics service did not respond. Refresh to retry.</div>
        </div>
      )}
      {!hasRevenue && !isError && !isLoading && (
        <div className="card-padded mb-4" style={{ borderLeft: '4px solid var(--warning)' }}>
          <div className="font-semibold">No settled payments in this period</div>
          <div className="text-sm text-ink-muted">Revenue here is real settled payments{practiceId ? ' for this practice' : ''}. Once payments land, the P&amp;L fills in automatically.</div>
        </div>
      )}
      {!costsAvailable && !isError && !isLoading && hasRevenue && (
        <div className="card-padded mb-4" style={{ borderLeft: '4px solid var(--warning)' }}>
          <div className="font-semibold">Costs &amp; profit shown as £0</div>
          <div className="text-sm text-ink-muted">
            {filters.method === 'cash'
              ? 'No cash-basis cost data yet. Cash figures appear after a QuickBooks re-sync; Xero/manual actuals are accrual-only.'
              : 'Revenue is real (settled payments) but we have no cost data for this period. Connect Xero/QuickBooks or enter P&L actuals.'}
          </div>
        </div>
      )}

      {/* KPI strip */}
      <div className="grid gap-4 mb-6" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <Kpi label="Revenue (period)" value={isLoading ? '…' : poundsCompact(grand.values.revenue)} delta="Real settled payments" />
        <Kpi label="Net profit (period)" value={isLoading ? '…' : (costsAvailable ? poundsCompact(grand.profit) : '£0')} delta={costsAvailable && grand.marginPct != null ? `${grand.marginPct.toFixed(1)}% margin` : 'no cost data (£0)'} />
        <Kpi label="Avg monthly revenue" value={isLoading ? '…' : poundsCompact(avgMonthlyRevenue)} delta={revenueMonths > 0 ? `over ${revenueMonths} mo with revenue` : undefined} />
        <Kpi label="Columns" value={String(renderCols.length)} delta={`${filters.groupBy} view`} />
      </div>

      {/* Revenue & profit chart */}
      <div className="card-padded mb-4">
        <h2 className="display text-lg font-semibold mb-5">Revenue &amp; profit</h2>
        {isLoading ? (
          <Skeleton className="w-full" style={{ height: 240 }} />
        ) : !hasRevenue ? (
          <div className="text-ink-muted" style={{ fontSize: 13, padding: '60px 0' }}>No settled payments in this period{practiceId ? ' for this practice.' : '.'}</div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'var(--ink-muted)' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--ink-soft)' }} axisLine={false} tickLine={false} tickFormatter={(v: number) => poundsCompact(v)} width={56} />
              <Tooltip formatter={(v: number, name: string) => [poundsCompact(v), name]} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Bar dataKey="Revenue" fill={BRAND} radius={[2, 2, 0, 0]} />
              <Bar dataKey="Profit" fill={ACCENT} radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* P&L matrix */}
      {renderCols.length > 0 && (
        <div className="card" style={{ overflowX: 'auto' }}>
          <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)' }}>
            <h2 className="display text-lg font-semibold">Profit &amp; Loss statement</h2>
          </div>
          <table className="w-full" style={{ fontSize: 13, minWidth: 520 }}>
            <thead>
              <tr className="text-ink-muted" style={{ textAlign: 'left' }}>
                <th style={{ padding: cellPad }}>Line</th>
                {renderCols.map((c) => (
                  <th key={c.key} className="text-right" style={{ padding: cellPad }}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PL_LINES.map((l) => (
                <tr key={l.key} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: cellPad }}><strong>{l.label}</strong></td>
                  {renderCols.map((c, ci) => {
                    const real = l.key === 'revenue' ? true : costsAvailable;
                    const pct = pctCells?.[ci]?.[l.key as LineKey];
                    return (
                      <td key={c.key} className="text-right text-ink-muted" style={{ padding: cellPad }}>
                        {fmtCell(c.values[l.key as LineKey], real)}
                        {filters.compare.pctOfIncome && pct != null && (
                          <span style={{ color: 'var(--ink-soft)', fontSize: 11 }}> ({pct.toFixed(0)}%)</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr style={{ borderTop: '2px solid var(--ink)' }} className="font-bold">
                <td style={{ padding: cellPad }}>Net profit</td>
                {renderCols.map((c) => (
                  <td key={c.key} className="text-right" style={{ padding: cellPad, color: costsAvailable ? 'var(--success)' : undefined }}>
                    {costsAvailable ? poundsCompact(c.profit) : '—'}
                  </td>
                ))}
              </tr>
              <tr style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: cellPad }}>Margin %</td>
                {renderCols.map((c) => (
                  <td key={c.key} className="text-right" style={{ padding: cellPad }}>
                    {c.marginPct == null ? <span className="text-ink-muted">—</span> : (
                      <span className={`chip ${c.marginPct >= 10 ? 'chip-emerald' : 'chip-amber'}`}>{c.marginPct.toFixed(1)}%</span>
                    )}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
