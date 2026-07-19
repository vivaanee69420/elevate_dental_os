'use client';
// A tiny inline-SVG lead-volume sparkline. Deliberately not recharts: this
// renders once per practice row, and recharts is already the heaviest thing in
// this bundle.
import type { TrendMonth } from '../api';

export function PracticeSparkline({ trend }: { trend: TrendMonth[] }) {
  const values = trend.map((t) =>
    t.channels.reduce((n, c) => n + c.leads, 0));

  if (values.length < 2) {
    return <span className="text-[11px] text-slate-400">Not enough history</span>;
  }

  const w = 72;
  const h = 20;
  const max = Math.max(...values, 1);
  const step = w / (values.length - 1);
  const points = values
    .map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`)
    .join(' ');

  const first = values[0];
  const last = values[values.length - 1];
  const stroke = last >= first ? '#0f766e' : '#b91c1c';

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={`Lead volume trend, ${first} to ${last} per month`}
    >
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
