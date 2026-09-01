'use client';
// Daily ad spend, stacked by channel.
//
// ONE axis. The obvious temptation on a marketing chart is to overlay cost per
// lead on a second y-scale; two scales let any two series be made to cross
// wherever the axis ranges happen to fall, so the comparison is an artefact of
// the scaling rather than the data. Cost per lead lives in the table below,
// where it is a number rather than an implied correlation.
//
// The points come from the SAME ad_metrics read that builds the campaign rows,
// so the chart and the tiles above it cannot drift apart.
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Legend,
} from 'recharts';
import { formatPence } from '@/lib/format';
import { CHANNEL_COLOUR, CHANNEL_LABEL, type SpendDay } from '../api';

// Axis and tooltip work in pounds; the data stays integer pence until display.
const toPounds = (pence: number) => pence / 100;

function dayLabel(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

interface Point { date: string; label: string; google: number; facebook: number; total: number }

function TrendTooltip({ active, payload }: {
  active?: boolean;
  payload?: Array<{ payload: Point }>;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-[12.5px] shadow-sm">
      <div className="mb-1 font-medium text-ink">{p.label}</div>
      <div className="flex items-center gap-2">
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: CHANNEL_COLOUR.google_ads }} />
        <span className="text-ink-muted">Google</span>
        <span className="ml-auto tabular-nums text-ink">{formatPence(Math.round(p.google * 100))}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: CHANNEL_COLOUR.meta_ads }} />
        <span className="text-ink-muted">Facebook</span>
        <span className="ml-auto tabular-nums text-ink">{formatPence(Math.round(p.facebook * 100))}</span>
      </div>
      <div className="mt-1 flex items-center gap-2 border-t border-border pt-1">
        <span className="text-ink-muted">Total</span>
        <span className="ml-auto tabular-nums font-medium text-ink">
          {formatPence(Math.round(p.total * 100))}
        </span>
      </div>
    </div>
  );
}

export function SpendTrend({ series }: { series: SpendDay[] }) {
  if (series.length < 2) return null;   // two points are not a trend

  const points: Point[] = series.map((d) => ({
    date: d.date,
    label: dayLabel(d.date),
    google: toPounds(d.google_ads),
    facebook: toPounds(d.meta_ads),
    total: toPounds(d.spendPence),
  }));

  // A month of daily points does not need 30 date labels; show roughly six.
  const tickGap = Math.max(1, Math.ceil(points.length / 6));

  return (
    <div className="rounded-panel border border-border bg-surface p-4">
      <div className="mb-1 text-[14px] font-medium text-ink">Daily spend</div>
      <p className="mb-3 text-[13px] text-ink-muted">
        What was spent each day, split by channel. Cost per lead is in the table below —
        plotting it here against a second scale would invent a relationship the data
        does not carry.
      </p>
      <div style={{ width: '100%', height: 260 }}>
        <ResponsiveContainer>
          <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 4, left: 4 }}>
            <CartesianGrid vertical={false} stroke="#e5e7eb" strokeDasharray="3 3" />
            <XAxis
              dataKey="label"
              interval={tickGap - 1}
              tick={{ fontSize: 12, fill: '#6b7280' }}
              tickLine={false}
              axisLine={{ stroke: '#e5e7eb' }}
            />
            <YAxis
              tick={{ fontSize: 12, fill: '#6b7280' }}
              tickLine={false}
              axisLine={false}
              width={56}
              tickFormatter={(v: number) => `£${v.toLocaleString('en-GB')}`}
            />
            <Tooltip content={<TrendTooltip />} cursor={{ stroke: '#9ca3af', strokeWidth: 1 }} />
            <Legend
              verticalAlign="top"
              align="right"
              height={28}
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ fontSize: 12.5, color: '#6b7280' }}
            />
            {/* Fixed series order, so a channel keeps its colour and its band
                position whichever one happens to be larger this month. The 2px
                stroke in the surface colour separates the stacked fills. */}
            <Area
              type="monotone"
              dataKey="google"
              name={CHANNEL_LABEL.google_ads}
              stackId="spend"
              stroke={CHANNEL_COLOUR.google_ads}
              strokeWidth={2}
              fill={CHANNEL_COLOUR.google_ads}
              fillOpacity={0.18}
            />
            <Area
              type="monotone"
              dataKey="facebook"
              name={CHANNEL_LABEL.meta_ads}
              stackId="spend"
              stroke={CHANNEL_COLOUR.meta_ads}
              strokeWidth={2}
              fill={CHANNEL_COLOUR.meta_ads}
              fillOpacity={0.18}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
