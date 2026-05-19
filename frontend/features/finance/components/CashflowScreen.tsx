'use client';
// Cash Flow — pixel-faithful port of preview/elevate-dental-os-v2.html
// (PAGES.cashflow). Monthly cash position across all bank accounts: a
// 3-up KPI strip, a running bank-balance bar chart, and a monthly
// revenue-in / costs-out / net / closing-balance table.
// Fed by the finance mock-data layer; swap to an open-banking feed
// (TrueLayer / Plaid) when one exists server-side.
//
// Data flow:
//   FINANCE_SERIES ──> running balance (start £180k + 95% of monthly profit)
//                  ──> balanceSeries ──> KPI strip + chart + table

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
import { FINANCE_SERIES, poundsCompact, monthLabel, monthShort } from '../mock';

const BRAND = '#0E7C7B';
const START_BALANCE = 180000;

// One KPI card in the prototype's 3-up strip (label / value / optional delta).
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

// Cash Flow page: 12-month running bank balance and monthly cash movements.
export default function CashflowScreen() {
  // Simulate a running bank balance from £180k, accruing ~95% of monthly
  // profit each month (non-cash adjustments approximated at 5%).
  const { balanceSeries, balance, chartData } = useMemo(() => {
    let running = START_BALANCE;
    const balanceSeries = FINANCE_SERIES.map((m) => {
      running += Math.round(m.profit * 0.95);
      return { ...m, balance: running };
    });
    const chartData = balanceSeries.map((m) => ({
      month: monthShort(m.month),
      Balance: m.balance,
    }));
    return { balanceSeries, balance: running, chartData };
  }, []);

  const growth = balance - START_BALANCE;
  const growthPct = ((growth / START_BALANCE) * 100).toFixed(0);

  return (
    <div className="container max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="display text-3xl font-bold">Cash Flow</h1>
        <p className="text-sm text-ink-muted">
          Monthly cash position across all bank accounts
        </p>
      </div>

      {/* KPI strip */}
      <div className="grid gap-4 mb-6" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <Kpi label="Current bank balance" value={poundsCompact(balance)} delta="All accounts" />
        <Kpi
          label="12-month cash growth"
          value={poundsCompact(growth)}
          delta={`+${growthPct}%`}
        />
        <Kpi
          label="Avg monthly cash gen"
          value={poundsCompact(Math.round(growth / 12))}
        />
      </div>

      {/* Cash balance chart */}
      <div className="card-padded mb-4">
        <h2 className="display text-lg font-semibold mb-5">Cash balance — 12 months</h2>
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
              formatter={(v: number) => [poundsCompact(v), 'Balance']}
              contentStyle={{ fontSize: 12, borderRadius: 8 }}
            />
            <Bar dataKey="Balance" fill={BRAND} radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Monthly cash flow table */}
      <div className="card-padded">
        <h2 className="display text-lg font-semibold mb-4">Monthly cash flow</h2>
        <table className="w-full" style={{ fontSize: 13, margin: '-16px 0 0' }}>
          <thead>
            <tr className="text-ink-muted" style={{ textAlign: 'left' }}>
              <th style={{ padding: '10px 8px' }}>Month</th>
              <th className="text-right" style={{ padding: '10px 8px' }}>Revenue in</th>
              <th className="text-right" style={{ padding: '10px 8px' }}>Costs out</th>
              <th className="text-right" style={{ padding: '10px 8px' }}>Net cash</th>
              <th className="text-right" style={{ padding: '10px 8px' }}>Closing balance</th>
            </tr>
          </thead>
          <tbody>
            {balanceSeries
              .slice()
              .reverse()
              .map((m) => {
                const costs = m.associate_pay + m.staff_costs + m.lab_materials + m.opex;
                const net = m.revenue - costs;
                return (
                  <tr key={m.month} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '10px 8px' }}>
                      <strong>{monthLabel(m.month)}</strong>
                    </td>
                    <td
                      className="text-right"
                      style={{ padding: '10px 8px', color: 'var(--success)' }}
                    >
                      +{poundsCompact(m.revenue)}
                    </td>
                    <td
                      className="text-right"
                      style={{ padding: '10px 8px', color: 'var(--danger)' }}
                    >
                      −{poundsCompact(costs)}
                    </td>
                    <td className="text-right font-semibold" style={{ padding: '10px 8px' }}>
                      {poundsCompact(net)}
                    </td>
                    <td className="text-right font-semibold" style={{ padding: '10px 8px' }}>
                      {poundsCompact(m.balance)}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
