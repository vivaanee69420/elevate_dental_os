'use client';
// Profit & Loss — real-data wired. 12-month consolidated P&L from
// GET /api/analytics/finance-series (baseline projection — derived, NOT
// filed accounts). KPI strip, revenue vs profit chart, monthly breakdown +
// FY total. Export PDF uses the same on-screen styling (brief 06 hard rule)
// via the print-window pattern. annualTotal/formatters stay pure helpers.

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { annualTotal, poundsCompact, monthLabel, monthShort } from '../mock';
import { useFinanceSeries } from '../hooks';
import FinanceToolbar from './FinanceToolbar';

const BRAND = '#0E7C7B';
const ACCENT = '#FFB547';

function Kpi({ label, value, delta }: { label: string; value: string; delta?: string }) {
  return (
    <div className="card-padded">
      <div className="text-xs text-ink-muted uppercase">{label}</div>
      <div className="display text-2xl font-bold mt-1">{value}</div>
      {delta && (
        <div className="text-xs font-semibold mt-1" style={{ color: '#10B981' }}>
          {delta}
        </div>
      )}
    </div>
  );
}

export default function ProfitScreen() {
  const { data, isLoading, isError } = useFinanceSeries();
  const series = data?.months ?? [];
  const noBaseline = !!data?.error;
  const hasData = series.length > 0;
  const annual = hasData
    ? annualTotal(series)
    : { revenue: 0, associate_pay: 0, staff_costs: 0, lab_materials: 0, opex: 0, profit: 0 };
  const latest = hasData ? series[series.length - 1] : null;
  const annualMargin =
    annual.revenue > 0 ? ((annual.profit / annual.revenue) * 100).toFixed(1) : '0';
  const chartData = series.map((m) => ({
    month: monthShort(m.month),
    Revenue: m.revenue,
    Profit: m.profit,
  }));

  function exportPdf() {
    const esc = (s: string) =>
      s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string);
    const rows = series
      .slice()
      .reverse()
      .map(
        (m) => `<tr><td>${esc(monthLabel(m.month))}</td><td class=r>${poundsCompact(
          m.revenue,
        )}</td><td class=r>${poundsCompact(m.associate_pay)}</td><td class=r>${poundsCompact(
          m.staff_costs,
        )}</td><td class=r>${poundsCompact(m.lab_materials)}</td><td class=r>${poundsCompact(
          m.opex,
        )}</td><td class=r>${poundsCompact(m.profit)}</td></tr>`,
      )
      .join('');
    const html = `<!doctype html><html><head><meta charset=utf-8><title>P&L — ${new Date().toLocaleDateString(
      'en-GB',
    )}</title><style>body{font:13px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#1F2937;margin:32px}h1{font-size:20px;margin:0}.sub{color:#6B7280;font-size:11px;margin:4px 0 20px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{padding:7px 10px;border-bottom:1px solid #E5E7EB;text-align:left}.r{text-align:right}tfoot td{font-weight:700;border-top:2px solid #1F2937}.f{color:#9CA3AF;font-size:10px;margin-top:18px}@media print{body{margin:14mm}}</style></head><body><h1>Profit &amp; Loss</h1><div class=sub>12-month rolling P&amp;L · baseline projection (derived, not filed accounts) · ${esc(
      new Date().toLocaleString('en-GB'),
    )}</div><table><thead><tr><th>Month</th><th class=r>Revenue</th><th class=r>Associate</th><th class=r>Staff</th><th class=r>Lab/mat</th><th class=r>OpEx</th><th class=r>Profit</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td>TOTAL</td><td class=r>${poundsCompact(
      annual.revenue,
    )}</td><td class=r>${poundsCompact(annual.associate_pay)}</td><td class=r>${poundsCompact(
      annual.staff_costs,
    )}</td><td class=r>${poundsCompact(annual.lab_materials)}</td><td class=r>${poundsCompact(
      annual.opex,
    )}</td><td class=r>${poundsCompact(annual.profit)}</td></tr></tfoot></table><div class=f>Elevate Dental OS — baseline-derived projection, not financial advice.</div></body></html>`;
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.focus();
    w.onload = () => w.print();
    setTimeout(() => {
      try {
        w.print();
      } catch {
        /* closed */
      }
    }, 400);
  }

  return (
    <div className="container max-w-7xl mx-auto">
      <div className="mb-6 flex justify-between items-start gap-4 flex-wrap">
        <div>
          <h1 className="display text-3xl font-bold">Profit &amp; Loss</h1>
          <p className="text-sm text-ink-muted">
            12-month rolling P&amp;L · baseline projection (derived, not filed
            accounts)
          </p>
        </div>
        <button
          type="button"
          onClick={exportPdf}
          disabled={!hasData}
          className="font-semibold"
          style={{
            padding: '9px 16px',
            fontSize: 13,
            border: '1px solid var(--border)',
            borderRadius: 6,
            background: 'white',
            opacity: hasData ? 1 : 0.5,
            cursor: hasData ? 'pointer' : 'default',
          }}
        >
          Export to PDF
        </button>
      </div>

      <FinanceToolbar />

      {isError && (
        <div className="card-padded mb-4">
          <div className="font-semibold">Could not load P&amp;L</div>
          <div className="text-sm text-ink-muted">
            The analytics service did not respond. Refresh to retry.
          </div>
        </div>
      )}
      {noBaseline && !isError && (
        <div className="card-padded mb-4" style={{ borderLeft: '4px solid #F59E0B' }}>
          <div className="font-semibold">No baseline set</div>
          <div className="text-sm text-ink-muted">
            The P&amp;L reads from your Business Health baseline. Complete setup
            to populate it.
          </div>
        </div>
      )}

      <div className="grid gap-4 mb-6" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <Kpi
          label="Annual revenue"
          value={isLoading ? '…' : poundsCompact(annual.revenue)}
          delta="12-month projection"
        />
        <Kpi
          label="Annual profit"
          value={isLoading ? '…' : poundsCompact(annual.profit)}
          delta={`${annualMargin}% margin`}
        />
        <Kpi
          label="Avg monthly revenue"
          value={isLoading ? '…' : poundsCompact(Math.round(annual.revenue / 12))}
        />
        <Kpi
          label="This month"
          value={isLoading ? '…' : poundsCompact(latest?.revenue ?? 0)}
        />
      </div>

      <div className="card-padded mb-4">
        <h2 className="display text-lg font-semibold mb-5">
          Revenue &amp; profit — last 12 months
        </h2>
        {isLoading ? (
          <div className="text-ink-muted" style={{ fontSize: 13, padding: '60px 0' }}>
            Loading…
          </div>
        ) : !hasData ? (
          <div className="text-ink-muted" style={{ fontSize: 13, padding: '60px 0' }}>
            No data — set your Business Health baseline.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
              <CartesianGrid stroke="#E5E7EB" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#64748B' }} axisLine={false} tickLine={false} />
              <YAxis
                tick={{ fontSize: 10, fill: '#94A3B8' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) => poundsCompact(v)}
                width={56}
              />
              <Tooltip
                formatter={(v: number, name: string) => [poundsCompact(v), name]}
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
              />
              <Bar dataKey="Revenue" fill={BRAND} radius={[2, 2, 0, 0]} />
              <Bar dataKey="Profit" fill={ACCENT} radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {hasData && (
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)' }}>
            <h2 className="display text-lg font-semibold">Monthly P&amp;L breakdown</h2>
          </div>
          <table className="w-full" style={{ fontSize: 13 }}>
            <thead>
              <tr className="text-ink-muted" style={{ textAlign: 'left' }}>
                <th style={{ padding: '10px 24px' }}>Month</th>
                <th className="text-right" style={{ padding: '10px 16px' }}>Revenue</th>
                <th className="text-right" style={{ padding: '10px 16px' }}>Associate pay</th>
                <th className="text-right" style={{ padding: '10px 16px' }}>Staff</th>
                <th className="text-right" style={{ padding: '10px 16px' }}>Lab/materials</th>
                <th className="text-right" style={{ padding: '10px 16px' }}>OpEx</th>
                <th className="text-right" style={{ padding: '10px 16px' }}>Profit</th>
                <th className="text-right" style={{ padding: '10px 24px' }}>Margin</th>
              </tr>
            </thead>
            <tbody>
              {series
                .slice()
                .reverse()
                .map((m) => {
                  const margin =
                    m.revenue > 0 ? ((m.profit / m.revenue) * 100).toFixed(1) : '0';
                  return (
                    <tr key={m.month} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '10px 24px' }}>
                        <strong>{monthLabel(m.month)}</strong>
                      </td>
                      <td className="text-right" style={{ padding: '10px 16px' }}>
                        {poundsCompact(m.revenue)}
                      </td>
                      <td className="text-right text-ink-muted" style={{ padding: '10px 16px' }}>
                        {poundsCompact(m.associate_pay)}
                      </td>
                      <td className="text-right text-ink-muted" style={{ padding: '10px 16px' }}>
                        {poundsCompact(m.staff_costs)}
                      </td>
                      <td className="text-right text-ink-muted" style={{ padding: '10px 16px' }}>
                        {poundsCompact(m.lab_materials)}
                      </td>
                      <td className="text-right text-ink-muted" style={{ padding: '10px 16px' }}>
                        {poundsCompact(m.opex)}
                      </td>
                      <td
                        className="text-right font-semibold"
                        style={{ padding: '10px 16px', color: 'var(--success)' }}
                      >
                        {poundsCompact(m.profit)}
                      </td>
                      <td className="text-right" style={{ padding: '10px 24px' }}>
                        <span
                          className={`chip ${
                            parseFloat(margin) >= 10 ? 'chip-emerald' : 'chip-amber'
                          }`}
                        >
                          {margin}%
                        </span>
                      </td>
                    </tr>
                  );
                })}
              <tr className="bg-bg font-bold">
                <td style={{ padding: '10px 24px' }}>TOTAL (12mo)</td>
                <td className="text-right" style={{ padding: '10px 16px' }}>
                  {poundsCompact(annual.revenue)}
                </td>
                <td className="text-right" style={{ padding: '10px 16px' }}>
                  {poundsCompact(annual.associate_pay)}
                </td>
                <td className="text-right" style={{ padding: '10px 16px' }}>
                  {poundsCompact(annual.staff_costs)}
                </td>
                <td className="text-right" style={{ padding: '10px 16px' }}>
                  {poundsCompact(annual.lab_materials)}
                </td>
                <td className="text-right" style={{ padding: '10px 16px' }}>
                  {poundsCompact(annual.opex)}
                </td>
                <td className="text-right" style={{ padding: '10px 16px', color: 'var(--success)' }}>
                  {poundsCompact(annual.profit)}
                </td>
                <td className="text-right" style={{ padding: '10px 24px' }}>
                  <span className="chip chip-emerald">{annualMargin}%</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
