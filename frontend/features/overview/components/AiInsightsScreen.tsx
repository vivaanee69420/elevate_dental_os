'use client';
// AI Insights — real-data wired. Sources:
//   • 12-month revenue/profit series ← GET /api/analytics/revenue-series
//     (baseline projection, derived — not live ledger)
//   • per-practice + per-source 30d rollups ← GET /api/analytics/ai-insights
//     (REAL leads/payments; locked D-Q2 conversion/pipeline defs)
// buildInsights/buildProjection are pure transforms over the fetched data.
// The prototype's hand-rolled SVG bar chart is reproduced with recharts.

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import Link from 'next/link';
import { Card, KpiTile, Chip, Skeleton, SkeletonText } from '@/components/ui';
import { formatPounds, formatPoundsCompact } from '@/features/_mock';
import { useState } from 'react';
import { buildInsights, buildProjection, type Insight } from '../data';
import { useRevenueSeries, useAiInsights } from '../hooks';
import { generateAiInsights } from '../api';

const INSIGHT_TONE: Record<
  Insight['type'],
  { bg: string; border: string; glyph: string }
> = {
  positive: { bg: '#D1FAE5', border: 'var(--success)', glyph: '✓' },
  warning: { bg: '#FEF3C7', border: 'var(--warning)', glyph: '!' },
  info: { bg: '#DBEAFE', border: '#3B82F6', glyph: 'i' },
};

// Map an insight action to a real in-app route. Rule-based actions have a
// known set; AI-generated actions are free text, so fall back to keyword
// matching. No match → no button (never a dead affordance).
function actionHref(action: string): string | null {
  const a = action.toLowerCase();
  const EXACT: Record<string, string> = {
    'review p&l': '/profit',
    'document process': '/workflows',
    'adjust reminders': '/workflows',
    'schedule review': '/kpiscorecard',
    'scale this': '/marketing',
  };
  if (EXACT[a]) return EXACT[a];
  if (a.includes('p&l') || a.includes('profit') || a.includes('margin'))
    return '/profit';
  if (a.includes('reminder') || a.includes('workflow') || a.includes('automat'))
    return '/workflows';
  if (
    a.includes('marketing') ||
    a.includes('source') ||
    a.includes('channel') ||
    a.includes('spend') ||
    a.includes('campaign')
  )
    return '/marketing';
  if (a.includes('lead') || a.includes('pipeline') || a.includes('convert'))
    return '/pipeline';
  if (a.includes('practice') || a.includes('kpi') || a.includes('scorecard'))
    return '/kpiscorecard';
  if (a.includes('cash') || a.includes('debtor')) return '/cashflow';
  return null;
}

function monthLabel(key: string): string {
  const m = parseInt(key.split('-')[1], 10);
  return [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ][m - 1];
}

export default function AiInsightsScreen() {
  const {
    data: seriesResp,
    isLoading: seriesLoading,
    isError: seriesError,
  } = useRevenueSeries();
  const {
    data: insightsResp,
    isLoading: insightsLoading,
    isError: insightsError,
  } = useAiInsights();

  // AI-generated cards (Claude). null = not generated yet → show rule-based.
  const [aiInsights, setAiInsights] = useState<Insight[] | null>(null);
  const [generating, setGenerating] = useState(false);
  const [aiNote, setAiNote] = useState<string | null>(null);

  async function generateFresh() {
    if (generating) return;
    setGenerating(true);
    setAiNote(null);
    try {
      const r = await generateAiInsights();
      if (r.insights.length > 0) {
        setAiInsights(r.insights);
      } else {
        setAiNote(
          r.error
            ? `AI analysis unavailable (${r.error}) — showing rule-based insights.`
            : 'AI returned no insights — showing rule-based insights.',
        );
      }
    } catch {
      setAiNote(
        'AI analysis failed — showing rule-based insights. Try again shortly.',
      );
    } finally {
      setGenerating(false);
    }
  }

  // Export the currently shown insights (AI or rule-based) as a PDF via the
  // browser's print-to-PDF — no extra dependency. Opens a clean report
  // window and triggers print; the user picks "Save as PDF".
  function downloadPdf() {
    const esc = (s: string) =>
      s.replace(
        /[&<>"]/g,
        (c) =>
          ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string,
      );
    const when = new Date().toLocaleString('en-GB');
    const kind = usingAi ? 'AI-generated' : 'Rule-based';
    const rows = insights
      .map(
        (i) => `
        <div class="card ${i.type}">
          <div class="t">${esc(i.title)}</div>
          <div class="d">${esc(i.detail)}</div>
          ${i.action ? `<div class="a">Next: ${esc(i.action)}</div>` : ''}
        </div>`,
      )
      .join('');
    const html = `<!doctype html><html><head><meta charset="utf-8">
      <title>AI Insights — ${esc(when)}</title>
      <style>
        body{font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#1F2937;margin:40px;}
        h1{font-size:22px;margin:0 0 4px;}
        .sub{color:var(--ink-muted);font-size:12px;margin-bottom:24px;}
        .card{border:1px solid var(--border);border-left-width:4px;border-radius:8px;padding:14px 16px;margin-bottom:12px;}
        .card.positive{border-left-color:var(--success);}
        .card.warning{border-left-color:var(--warning);}
        .card.info{border-left-color:#3B82F6;}
        .t{font-weight:600;margin-bottom:4px;}
        .d{color:#374151;font-size:13px;}
        .a{color:var(--ink-muted);font-size:12px;margin-top:6px;}
        .f{color:#9CA3AF;font-size:11px;margin-top:24px;border-top:1px solid var(--border);padding-top:10px;}
        @media print{body{margin:16mm;}}
      </style></head><body>
      <h1>AI Insights</h1>
      <div class="sub">${kind} · generated ${esc(when)} · ${insights.length} insight(s)</div>
      ${rows || '<p>No insights to export.</p>'}
      <div class="f">Elevate Dental OS — figures are baseline-derived projections / live rollups; AI cards are model-generated. Not financial advice.</div>
      </body></html>`;
    const w = window.open('', '_blank');
    if (!w) {
      setAiNote('Allow pop-ups to export the PDF.');
      return;
    }
    w.document.write(html);
    w.document.close();
    w.focus();
    w.onload = () => {
      w.print();
    };
    // Fallback if onload already fired.
    setTimeout(() => {
      try {
        w.print();
      } catch {
        /* user closed the window */
      }
    }, 400);
  }

  const loading = seriesLoading || insightsLoading;
  const errored = seriesError || insightsError;
  const noBaseline = !!seriesResp?.error;

  const series = seriesResp?.series ?? [];
  const practices = insightsResp?.practices ?? [];
  const sources = insightsResp?.sources ?? [];

  const last3Avg =
    series.length > 0
      ? series.slice(-3).reduce((s, m) => s + m.revenue, 0) /
        Math.min(3, series.length)
      : 0;
  const projectedRevenue90 = last3Avg * 3;
  const marginFrac =
    series.length > 0 && series[series.length - 1].revenue > 0
      ? series[series.length - 1].profit / series[series.length - 1].revenue
      : 0.1;
  const projectedProfit90 = projectedRevenue90 * marginFrac;

  const insights = aiInsights ?? buildInsights(series, practices, sources);
  const positiveCount = insights.filter((i) => i.type === 'positive').length;
  const warningCount = insights.filter((i) => i.type === 'warning').length;
  const usingAi = aiInsights !== null;

  const chartData = buildProjection(series).map((p) => ({
    name: monthLabel(p.month),
    Revenue: p.revenue,
    Profit: p.profit,
  }));

  return (
    <div className="container mx-auto" style={{ maxWidth: 1500 }}>
      <div className="mb-6 flex justify-between items-start gap-4 flex-wrap">
        <div>
          <h1 className="display text-3xl font-bold">AI Insights</h1>
          <p className="text-sm text-ink-muted mt-1">
            Patterns and anomalies surfaced from your data — last 30 days
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={downloadPdf}
            disabled={loading || insights.length === 0}
            className="font-semibold"
            style={{
              padding: '9px 16px',
              fontSize: 13,
              border: '1px solid var(--border)',
              borderRadius: 6,
              background: 'white',
              opacity: loading || insights.length === 0 ? 0.5 : 1,
              cursor:
                loading || insights.length === 0 ? 'default' : 'pointer',
            }}
          >
            Download PDF
          </button>
          <button
            type="button"
            onClick={generateFresh}
            disabled={generating || loading}
            className="btn btn-primary font-semibold"
            style={{
              padding: '9px 16px',
              fontSize: 13,
              opacity: generating || loading ? 0.6 : 1,
              cursor: generating || loading ? 'default' : 'pointer',
            }}
          >
            {generating ? 'Analysing your data…' : 'Generate AI insights'}
          </button>
        </div>
      </div>

      {errored && (
        <Card className="mb-4">
          <div className="font-semibold" style={{ fontSize: 14 }}>
            Could not load insights
          </div>
          <p className="text-ink-muted" style={{ fontSize: 13, marginTop: 4 }}>
            The analytics service did not respond. Refresh to retry.
          </p>
        </Card>
      )}

      {noBaseline && !errored && (
        <Card className="mb-4">
          <div className="font-semibold" style={{ fontSize: 14 }}>
            No baseline set
          </div>
          <p className="text-ink-muted" style={{ fontSize: 13, marginTop: 4 }}>
            The revenue forecast and projection read from your Business Health
            baseline. Complete setup to populate them. Per-practice and
            per-source insights still reflect your live leads.
          </p>
        </Card>
      )}

      {/* Forecast KPIs */}
      <div
        className="grid mb-4"
        style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}
      >
        <KpiTile
          label="Insights this week"
          value={loading ? '…' : String(insights.length)}
          delta={`${positiveCount} positive · ${warningCount} warning`}
          deltaTone="up"
        />
        <KpiTile
          label="90-day revenue forecast"
          value={
            loading ? '…' : noBaseline ? '—' : formatPoundsCompact(projectedRevenue90)
          }
          delta="Baseline projection · 3mo trailing avg"
          deltaTone="up"
        />
        <KpiTile
          label="90-day profit forecast"
          value={
            loading ? '…' : noBaseline ? '—' : formatPoundsCompact(projectedProfit90)
          }
          delta="At baseline margin"
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
            {usingAi ? 'AI-generated insights' : 'Live insights'}
          </h2>
          <Chip colour="brand">
            {usingAi
              ? 'AI analysis'
              : insightsResp?.truncated
                ? 'Partial data'
                : 'Rule-based'}
          </Chip>
        </div>
        {aiNote && (
          <div
            className="text-ink-muted"
            style={{
              padding: '10px 20px',
              fontSize: 12,
              borderBottom: '1px solid var(--border)',
            }}
          >
            {aiNote}
          </div>
        )}
        {loading ? (
          <div className="p-5 space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <SkeletonText key={i} lines={2} />
            ))}
          </div>
        ) : insights.length === 0 ? (
          <div
            className="text-ink-muted"
            style={{ padding: '24px 20px', fontSize: 13 }}
          >
            Not enough data yet to surface insights.
          </div>
        ) : (
          insights.map((insight) => {
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
                  <div
                    style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}
                  >
                    {insight.title}
                  </div>
                  <div
                    className="text-ink-muted"
                    style={{ fontSize: 13, lineHeight: 1.5 }}
                  >
                    {insight.detail}
                  </div>
                </div>
                {actionHref(insight.action) && (
                  <Link
                    href={actionHref(insight.action) as string}
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
                  </Link>
                )}
              </div>
            );
          })
        )}
      </Card>

      {/* 90-day forward projection */}
      <Card>
        <h2
          className="display font-semibold"
          style={{ fontSize: 17, marginBottom: 12 }}
        >
          90-day forward projection
        </h2>
        {loading ? (
          <Skeleton className="w-full" style={{ height: 240 }} />
        ) : chartData.length === 0 ? (
          <div
            className="text-ink-muted"
            style={{ fontSize: 13, padding: '40px 0' }}
          >
            No projection — set your Business Health baseline.
          </div>
        ) : (
          <div style={{ width: '100%', height: 240 }}>
            <ResponsiveContainer>
              <BarChart
                data={chartData}
                margin={{ top: 20, right: 20, bottom: 10, left: 0 }}
              >
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 10, fill: 'var(--ink-soft)' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: 'var(--ink-soft)' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(val: number) => formatPoundsCompact(val)}
                  width={56}
                />
                <Tooltip
                  formatter={(val: number, n: string) => [formatPounds(val), n]}
                  contentStyle={{ fontSize: 12 }}
                />
                <Bar dataKey="Revenue" fill="var(--brand)" radius={[2, 2, 0, 0]} />
                <Bar dataKey="Profit" fill="var(--accent)" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        <p className="text-ink-muted" style={{ fontSize: 11, marginTop: 12 }}>
          Last 6 actual months + 3 month forward projection · baseline-derived,
          seasonality adjusted
        </p>
      </Card>
    </div>
  );
}
