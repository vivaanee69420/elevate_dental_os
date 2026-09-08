'use client';
// ============================================================================
// Money in against money out, as a trend.
//
// ============================================================================
// IT DRAWS `trend`, NOT `months`, AND THAT IS THE WHOLE POINT.
//
// The months table follows the page's date picker, which defaults to the
// current month — so a chart built from it was ONE BAR, alone, in an empty
// plot. A trend with a single point is not a trend, and no amount of styling
// rescues it. `trend` is the trailing window the run-rate already uses:
// complete months ending today, whatever the picker says. The table beside
// this stays exact and windowed; the chart gets a series worth drawing.
//
// ============================================================================
// TWO LINES, FILLED, NOT STACKED. Money in and money out are compared, never
// summed, so the areas overlap deliberately and both fills are translucent —
// where the red sits above the green, that month cost more than it earned, and
// that is the one thing this chart exists to make obvious at a glance.
//
// Out is plotted POSITIVE here. Two lines on one scale can be compared
// directly by height; mirroring one below the axis would make the comparison a
// mental reflection instead of a glance.
//
// WHAT IS DELIBERATELY NOT DRAWN: the out series at all, when there is no cost
// feed or the scope is a practice (costs are org-level by design). A flat line
// at zero would say "spent nothing" where the truth is "not measured here".
// ============================================================================
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import type { CashflowOutlook } from '../api';

const IN = 'var(--success)';
const OUT = 'var(--danger)';

const gbp = (n: number) => '£' + Math.round(n).toLocaleString('en-GB');
// Axis ticks only — full precision belongs in the tooltip and the table.
const compact = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `£${(a / 1_000_000).toFixed(1)}m`;
  if (a >= 1_000) return `£${Math.round(a / 1_000)}k`;
  return `£${Math.round(a)}`;
};
const monthLabel = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, (m || 1) - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
};

export default function CashflowChart({ outlook }: { outlook: CashflowOutlook }) {
  const series = outlook.trend.length ? outlook.trend : outlook.months;
  const showOut = outlook.costsAvailable;

  const data = series.map((m) => ({
    month: monthLabel(m.month),
    'Money in': m.in,
    'Money out': m.costsAvailable ? m.out : null,
  }));

  // One point draws no line, only a gap — show the dots in that case rather
  // than an empty plot that looks broken.
  const sparse = data.length < 2;

  return (
    <div>
      <ResponsiveContainer width="100%" height={250}>
        <AreaChart data={data} margin={{ top: 10, right: 8, left: 8, bottom: 4 }}>
          <defs>
            {/* Soft fills, so the overlap reads without either series hiding
                the other. */}
            <linearGradient id="cf-in" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={IN} stopOpacity={0.28} />
              <stop offset="100%" stopColor={IN} stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="cf-out" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={OUT} stopOpacity={0.2} />
              <stop offset="100%" stopColor={OUT} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="month"
            tick={{ fontSize: 11, fill: 'var(--ink-muted)' }}
            axisLine={false}
            tickLine={false}
            padding={{ left: 8, right: 8 }}
          />
          <YAxis
            tick={{ fontSize: 10, fill: 'var(--ink-soft)' }}
            axisLine={false}
            tickLine={false}
            tickFormatter={compact}
            width={54}
          />
          <Tooltip
            cursor={{ stroke: 'var(--border)', strokeWidth: 1 }}
            contentStyle={{ fontSize: 12, borderRadius: 10, border: '1px solid var(--border)' }}
            formatter={(v, name) => {
              const n = typeof v === 'number' ? v : Number(v);
              return [Number.isFinite(n) ? gbp(n) : 'not measured', String(name)];
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
          <Area
            type="monotone"
            dataKey="Money in"
            stroke={IN}
            strokeWidth={2.5}
            fill="url(#cf-in)"
            dot={sparse ? { r: 4 } : false}
            activeDot={{ r: 5 }}
            animationDuration={900}
            animationEasing="ease-out"
          />
          {showOut && (
            <Area
              type="monotone"
              dataKey="Money out"
              stroke={OUT}
              strokeWidth={2.5}
              fill="url(#cf-out)"
              dot={sparse ? { r: 4 } : false}
              activeDot={{ r: 5 }}
              // Staggered, so the two series resolve one after the other
              // rather than racing each other into place.
              animationBegin={180}
              animationDuration={900}
              animationEasing="ease-out"
              connectNulls={false}
            />
          )}
        </AreaChart>
      </ResponsiveContainer>

      <p className="text-ink-muted" style={{ fontSize: 11, marginTop: 6 }}>
        {series.length} month{series.length === 1 ? '' : 's'} to date — this trend covers recent
        months whatever period is selected above, so it stays readable on a single-month view.
        The table beside it follows your selection exactly.
      </p>
    </div>
  );
}
