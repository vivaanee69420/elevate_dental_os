'use client';
// Profit & Loss — pixel-faithful port of preview/elevate-dental-os-v2.html
// (PAGES.profit). 12-month rolling consolidated P&L: KPI strip, revenue vs
// profit bar chart, and a month-by-month breakdown table with an FY total row.
// Fed by the finance mock-data layer; swap to a real consolidated-P&L
// endpoint when one exists server-side.
//
// Data flow:
//   FINANCE_SERIES ─┬─> annualTotal() ──> KPI strip + FY26 total row
//                    └─> per-month rows + recharts bar chart (revenue|profit)

import { useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { FINANCE_SERIES, annualTotal, poundsCompact, monthLabel, monthShort } from '../mock';

const BRAND = '#0E7C7B';
const ACCENT = '#FFB547';

// One KPI card in the prototype's 4-up strip (label / value / optional delta).
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

// Profit & Loss page: consolidated 12-month rolling P&L for the group.
export default function ProfitScreen() {
  // Derive annual totals and the chart series once from the shared dataset.
  const { series, annual, latest, chartData } = useMemo(() => {
    const series = FINANCE_SERIES;
    const annual = annualTotal(series);
    const latest = series[series.length - 1];
    const chartData = series.map((m) => ({
      month: monthShort(m.month),
      Revenue: m.revenue,
      Profit: m.profit,
    }));
    return { series, annual, latest, chartData };
  }, []);

  const annualMargin = ((annual.profit / annual.revenue) * 100).toFixed(1);

  return (
    <div className="container max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="display text-3xl font-bold">Profit &amp; Loss</h1>
        <p className="text-sm text-ink-muted">
          12-month rolling P&amp;L · GM Dental Group consolidated
        </p>
      </div>

      {/* KPI strip */}
      <div className="grid gap-4 mb-6" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <Kpi
          label="Annual revenue"
          value={poundsCompact(annual.revenue)}
          delta="FY ending May 2026"
        />
        <Kpi
          label="Annual profit"
          value={poundsCompact(annual.profit)}
          delta={`${annualMargin}% margin`}
        />
        <Kpi label="Avg monthly revenue" value={poundsCompact(Math.round(annual.revenue / 12))} />
        <Kpi label="This month" value={poundsCompact(latest.revenue)} />
      </div>

      {/* Revenue & profit chart */}
      <div className="card-padded mb-4">
        <h2 className="display text-lg font-semibold mb-5">
          Revenue &amp; profit — last 12 months
        </h2>
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
      </div>

      {/* Monthly P&L breakdown */}
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
                const margin = ((m.profit / m.revenue) * 100).toFixed(1);
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
              <td style={{ padding: '10px 24px' }}>TOTAL FY26</td>
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
    </div>
  );
}
