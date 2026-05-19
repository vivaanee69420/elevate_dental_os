'use client';
// AI Insights — pixel-faithful port of preview/elevate-dental-os-v2.html
// (PAGES['ai-insights']). Surfaces patterns and anomalies from the last 30
// days: 3 forecast KPIs, a "Live insights" card list, and a 90-day forward
// projection bar chart (6 actual months + 3 projected). All figures come from
// ../data.ts (mock only, no backend). The prototype's hand-rolled SVG
// renderBarChart is reproduced here with recharts.

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { Card, KpiTile, Chip } from '@/components/ui';
import { formatPounds, formatPoundsCompact } from '@/features/_mock';
import {
  MONTHLY_SERIES,
  buildInsights,
  buildProjection,
  type Insight,
} from '../data';

// Tone palette per insight type, lifted from the prototype's `colors` map.
const INSIGHT_TONE: Record<
  Insight['type'],
  { bg: string; border: string; glyph: string }
> = {
  positive: { bg: '#D1FAE5', border: '#10B981', glyph: '✓' },
  warning: { bg: '#FEF3C7', border: '#F59E0B', glyph: '!' },
  info: { bg: '#DBEAFE', border: '#3B82F6', glyph: 'i' },
};

/** Short month label (e.g. "Nov") for the chart x-axis. */
function monthLabel(key: string): string {
  const m = parseInt(key.split('-')[1], 10);
  return [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ][m - 1];
}

/** AI Insights page. */
export default function AiInsightsScreen() {
  const series = MONTHLY_SERIES;
  // 3-month trailing average drives both forecast KPIs.
  const last3Avg = series.slice(-3).reduce((s, m) => s + m.revenue, 0) / 3;
  const projectedRevenue90 = last3Avg * 3;
  const projectedProfit90 = projectedRevenue90 * 0.1;

  const insights = buildInsights();
  const positiveCount = insights.filter((i) => i.type === 'positive').length;
  const warningCount = insights.filter((i) => i.type === 'warning').length;

  // Combined 6-actual + 3-projected series, mapped to a recharts-friendly row.
  const chartData = buildProjection().map((p) => ({
    name: monthLabel(p.month),
    Revenue: p.revenue,
    Profit: p.profit,
  }));

  return (
    <div className="container mx-auto" style={{ maxWidth: 1500 }}>
      <div className="mb-6">
        <h1 className="display text-3xl font-bold">AI Insights</h1>
        <p className="text-sm text-ink-muted mt-1">
          Patterns and anomalies surfaced from your data — last 30 days
        </p>
      </div>

      {/* Forecast KPIs */}
      <div
        className="grid mb-4"
        style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}
      >
        <KpiTile
          label="Insights this week"
          value={String(insights.length)}
          delta={`${positiveCount} positive · ${warningCount} warning`}
          deltaTone="up"
        />
        <KpiTile
          label="90-day revenue forecast"
          value={formatPoundsCompact(projectedRevenue90)}
          delta="Based on 3mo trailing avg"
          deltaTone="up"
        />
        <KpiTile
          label="90-day profit forecast"
          value={formatPoundsCompact(projectedProfit90)}
          delta="~10% margin assumed"
          deltaTone="up"
        />
      </div>

      {/* Live insights list */}
      <Card padded={false} className="mb-4">
        <div
          className="flex justify-between items-center"
          style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}
        >
          <h2 className="display font-semibold" style={{ fontSize: 17 }}>
            Live insights
          </h2>
          <Chip colour="brand">Updated 2 min ago</Chip>
        </div>
        {insights.map((insight) => {
          const tone = INSIGHT_TONE[insight.type];
          return (
            <div
              key={insight.title}
              className="flex"
              style={{
                gap: 14,
                padding: '16px 20px',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <div
                className="flex items-center justify-center flex-shrink-0 font-bold"
                style={{
                  width: 36,
                  height: 36,
                  background: tone.bg,
                  color: tone.border,
                  borderRadius: 8,
                }}
              >
                {tone.glyph}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
                  {insight.title}
                </div>
                <div
                  className="text-ink-muted"
                  style={{ fontSize: 13, lineHeight: 1.5 }}
                >
                  {insight.detail}
                </div>
              </div>
              <button
                type="button"
                className="font-medium self-center"
                style={{
                  fontSize: 12,
                  padding: '6px 10px',
                  whiteSpace: 'nowrap',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  background: 'white',
                }}
              >
                {insight.action} &rarr;
              </button>
            </div>
          );
        })}
      </Card>

      {/* 90-day forward projection */}
      <Card>
        <h2
          className="display font-semibold"
          style={{ fontSize: 17, marginBottom: 12 }}
        >
          90-day forward projection
        </h2>
        <div style={{ width: '100%', height: 240 }}>
          <ResponsiveContainer>
            <BarChart data={chartData} margin={{ top: 20, right: 20, bottom: 10, left: 0 }}>
              <CartesianGrid stroke="#E5E7EB" vertical={false} />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 10, fill: '#94A3B8' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 10, fill: '#94A3B8' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) => formatPoundsCompact(v)}
                width={56}
              />
              <Tooltip
                formatter={(v: number, n: string) => [formatPounds(v), n]}
                contentStyle={{ fontSize: 12 }}
              />
              <Bar dataKey="Revenue" fill="#0E7C7B" radius={[2, 2, 0, 0]} />
              <Bar dataKey="Profit" fill="#FFB547" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p
          className="text-ink-muted"
          style={{ fontSize: 11, marginTop: 12 }}
        >
          Last 6 actual months + 3 month forward projection · seasonality
          adjusted
        </p>
      </Card>
    </div>
  );
}
