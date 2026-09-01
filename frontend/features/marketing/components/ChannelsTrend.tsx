'use client';
// Cost per lead, month by month, per channel.
//
// ONE axis, and one measure. The obvious version of this chart plots spend as
// bars with cost per lead on a second y-scale, but two scales let any two
// series be made to cross wherever the ranges happen to fall — the reader sees
// a relationship the data does not contain. Spend gets its own chart below,
// sharing this one's x-axis, which is the honest version of the same comparison.
//
// A gap in a line means that channel spent nothing that month, so it HAS no
// cost per lead. connectNulls is off: bridging the gap would draw a cost that
// was never paid.
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  ResponsiveContainer, Legend,
} from 'recharts';
import { formatPence } from '@/lib/format';
import { CHANNEL_COLOUR, CHANNEL_LABEL, type TrendMonth } from '../api';

const PAID = ['meta_ads', 'google_ads'] as const;

function monthLabel(iso: string) {
  const [y, m] = iso.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
}

interface Point {
  label: string;
  meta_cpl: number | null;
  google_cpl: number | null;
  meta_spend: number;
  google_spend: number;
  meta_leads: number;
  google_leads: number;
}

function toPoints(months: TrendMonth[]): Point[] {
  return months.map((m) => ({
    label: monthLabel(m.month),
    meta_cpl: m.channels.meta_ads.costPerLeadPence === null
      ? null : m.channels.meta_ads.costPerLeadPence / 100,
    google_cpl: m.channels.google_ads.costPerLeadPence === null
      ? null : m.channels.google_ads.costPerLeadPence / 100,
    meta_spend: m.channels.meta_ads.spendPence / 100,
    google_spend: m.channels.google_ads.spendPence / 100,
    meta_leads: m.channels.meta_ads.leads,
    google_leads: m.channels.google_ads.leads,
  }));
}

function CplTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: Point }> }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const line = (key: 'meta' | 'google', channel: 'meta_ads' | 'google_ads') => {
    const cpl = key === 'meta' ? p.meta_cpl : p.google_cpl;
    const leads = key === 'meta' ? p.meta_leads : p.google_leads;
    return (
      <div className="flex items-center gap-2">
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: CHANNEL_COLOUR[channel] }} />
        <span className="text-ink-muted">{CHANNEL_LABEL[channel]}</span>
        <span className="ml-auto tabular-nums text-ink">
          {cpl === null ? 'no spend' : `${formatPence(Math.round(cpl * 100))} · ${leads} leads`}
        </span>
      </div>
    );
  };
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-[12.5px] shadow-sm">
      <div className="mb-1 font-medium text-ink">{p.label}</div>
      {line('meta', 'meta_ads')}
      {line('google', 'google_ads')}
    </div>
  );
}

const axis = { fontSize: 12, fill: '#6b7280' };

export function ChannelsTrend({ months }: { months: TrendMonth[] }) {
  if (months.length < 2) return null;
  const points = toPoints(months);

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-panel border border-border bg-surface p-4">
        <div className="mb-1 text-[14px] font-medium text-ink">Cost per lead</div>
        <p className="mb-3 text-[13px] text-ink-muted">
          What each channel paid for an enquiry, month by month. A gap means that channel
          spent nothing that month, so it has no cost — not a cost of zero.
        </p>
        <div style={{ width: '100%', height: 260 }}>
          <ResponsiveContainer>
            <LineChart data={points} margin={{ top: 8, right: 8, bottom: 4, left: 4 }}>
              <CartesianGrid vertical={false} stroke="#e5e7eb" strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} />
              <YAxis
                tick={axis}
                tickLine={false}
                axisLine={false}
                width={56}
                tickFormatter={(v: number) => `£${v.toLocaleString('en-GB')}`}
              />
              <Tooltip content={<CplTooltip />} cursor={{ stroke: '#9ca3af', strokeWidth: 1 }} />
              <Legend
                verticalAlign="top"
                align="right"
                height={28}
                iconType="circle"
                iconSize={8}
                wrapperStyle={{ fontSize: 12.5, color: '#6b7280' }}
              />
              <Line
                type="monotone"
                dataKey="meta_cpl"
                name={CHANNEL_LABEL.meta_ads}
                stroke={CHANNEL_COLOUR.meta_ads}
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls={false}
              />
              <Line
                type="monotone"
                dataKey="google_cpl"
                name={CHANNEL_LABEL.google_ads}
                stroke={CHANNEL_COLOUR.google_ads}
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-panel border border-border bg-surface p-4">
        <div className="mb-1 text-[14px] font-medium text-ink">Spend</div>
        <p className="mb-3 text-[13px] text-ink-muted">
          The same months, so the cost line above can be read against what was actually
          being spent — on its own axis rather than squeezed onto that chart&apos;s.
        </p>
        <div style={{ width: '100%', height: 200 }}>
          <ResponsiveContainer>
            <BarChart data={points} margin={{ top: 8, right: 8, bottom: 4, left: 4 }} barGap={2}>
              <CartesianGrid vertical={false} stroke="#e5e7eb" strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} />
              <YAxis
                tick={axis}
                tickLine={false}
                axisLine={false}
                width={56}
                tickFormatter={(v: number) => `£${(v / 1000).toLocaleString('en-GB')}k`}
              />
              <Tooltip
                cursor={{ fill: '#f3f4f6' }}
                formatter={(v: number, n: string) => [formatPence(Math.round(v * 100)), n]}
                contentStyle={{ fontSize: 12.5, borderRadius: 8, borderColor: '#e5e7eb' }}
              />
              <Legend
                verticalAlign="top"
                align="right"
                height={28}
                iconType="circle"
                iconSize={8}
                wrapperStyle={{ fontSize: 12.5, color: '#6b7280' }}
              />
              {PAID.map((c) => (
                <Bar
                  key={c}
                  dataKey={c === 'meta_ads' ? 'meta_spend' : 'google_spend'}
                  name={CHANNEL_LABEL[c]}
                  fill={CHANNEL_COLOUR[c]}
                  radius={[4, 4, 0, 0]}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
