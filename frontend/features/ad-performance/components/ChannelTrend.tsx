'use client';
// Cost per lead and lead volume by month, per channel. The points come from the
// same server-side computation as the scorecard, so the trend can never
// disagree with the totals above it.
import {
  LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Legend,
} from 'recharts';
import { Card } from '@/components/ui';
import type { TrendMonth } from '../api';

interface Point {
  month: string;
  googleLeads: number;
  facebookLeads: number;
  googleCpl: number | null;
  facebookCpl: number | null;
}

// Pence -> pounds for the axis; a null cost per lead becomes a gap in the line
// rather than a plotted zero, which would read as "leads became free".
function toPoints(trend: TrendMonth[]): Point[] {
  return trend.map((t) => {
    const g = t.channels.find((c) => c.channel === 'google_ads');
    const f = t.channels.find((c) => c.channel === 'meta_ads');
    const [y, m] = t.month.split('-');
    const label = new Date(Number(y), Number(m) - 1, 1)
      .toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
    return {
      month: label,
      googleLeads: g?.leads ?? 0,
      facebookLeads: f?.leads ?? 0,
      googleCpl: g?.costPerLeadPence == null ? null : g.costPerLeadPence / 100,
      facebookCpl: f?.costPerLeadPence == null ? null : f.costPerLeadPence / 100,
    };
  });
}

export function ChannelTrend({ trend }: { trend: TrendMonth[] }) {
  const points = toPoints(trend);
  return (
    <Card>
      <h2 className="mb-2 text-[15px] font-semibold text-slate-900">Trend</h2>
      <div style={{ width: '100%', height: 260 }}>
        <ResponsiveContainer>
          <LineChart data={points} margin={{
            top: 8, right: 8, bottom: 8, left: 8,
          }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="month" tick={{ fontSize: 12 }} />
            <YAxis yAxisId="leads" tick={{ fontSize: 12 }} />
            <YAxis
              yAxisId="cpl"
              orientation="right"
              tick={{ fontSize: 12 }}
              tickFormatter={(v) => `£${v}`}
            />
            <Tooltip formatter={(v, name) => (String(name).includes('cost') ? `£${v}` : v)} />
            <Legend />
            <Line yAxisId="leads" type="monotone" dataKey="googleLeads" name="Google leads" stroke="#0f766e" dot={false} />
            <Line yAxisId="leads" type="monotone" dataKey="facebookLeads" name="Facebook leads" stroke="#1d4ed8" dot={false} />
            <Line
              yAxisId="cpl"
              type="monotone"
              dataKey="googleCpl"
              name="Google cost per lead"
              stroke="#0f766e"
              strokeDasharray="4 3"
              dot={false}
              connectNulls={false}
            />
            <Line
              yAxisId="cpl"
              type="monotone"
              dataKey="facebookCpl"
              name="Facebook cost per lead"
              stroke="#1d4ed8"
              strokeDasharray="4 3"
              dot={false}
              connectNulls={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {points.length === 0 ? <p className="py-3 text-sm text-slate-500">Not enough history to plot a trend.</p> : null}
    </Card>
  );
}
