// Overview section — local mock-data layer.
//
// Feeds the AI Insights and Plan4Growth AI screens. The prototype
// (preview/elevate-dental-os-v2.html, PAGES['ai-insights'] / PAGES['p4g-ai'])
// derived these figures from a base64-gzipped DATASET blob; here we
// reproduce equivalent figures deterministically at the prototype's scale so
// the ported screens render pixel-faithful with no backend. When real
// /api/analytics endpoints land, swap these for fetched data; the component
// contracts stay stable.
//
// Convention: amounts are WHOLE POUNDS (matches the prototype's arithmetic
// and @/features/_mock's formatPounds). Pence conversion happens at the
// future backend swap point, not here.
//
// ASCII data-flow:
//   MONTHLY_SERIES ──► AiInsightsScreen (deltas, KPIs, forward projection)
//   PRACTICE_SUMMARY ─┐
//   SOURCE_SUMMARY ───┴► AiInsightsScreen (insight cards)
//   answerP4G(question) ◄── P4gAiScreen (chat replies)

import { PRACTICES, formatPounds, formatPoundsCompact } from '@/features/_mock';

/** One synthesised month of group-wide actuals. Whole pounds. */
export interface MonthPoint {
  /** ISO month key, e.g. "2025-11". */
  month: string;
  /** Group revenue that month. */
  revenue: number;
  /** Group net profit that month. */
  profit: number;
}

/**
 * Twelve trailing months of group revenue/profit, synthesised the same way
 * the prototype dataset is (gentle growth + a 3-month ripple), ending on the
 * current month. ~£10m annualised at the prototype's ~10% monthly margin.
 */
export const MONTHLY_SERIES: MonthPoint[] = (() => {
  const now = new Date();
  const out: MonthPoint[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const idx = 11 - i;
    const revenue = Math.round(815000 + idx * 9000 + (idx % 3) * 12000);
    out.push({
      month: d.toISOString().slice(0, 7),
      revenue,
      profit: Math.round(revenue * 0.1),
    });
  }
  return out;
})();

/** Per-practice 30-day rollup used by the insight cards. */
export interface PracticeStat {
  name: string;
  conversionRate: number; // percentage points
  revenue30d: number; // whole pounds
}

/**
 * Per-practice conversion + revenue, deterministic from PRACTICES order so
 * the "top vs bottom converter" insight is stable across renders.
 */
export const PRACTICE_SUMMARY: PracticeStat[] = PRACTICES.map((name, i) => ({
  name,
  conversionRate: 14 + ((i * 7) % 11) + i, // spread 14%..~31%
  revenue30d: 78000 + i * 14000,
}));

/** Per-source 30-day rollup used by the "best source" insight. */
export interface SourceStat {
  name: string;
  conversionRate: number; // percentage points
  leads: number;
  pipelineValue: number; // whole pounds
}

/** Acquisition sources, deterministic, prototype-scale figures. */
export const SOURCE_SUMMARY: SourceStat[] = [
  { name: 'Meta Lead Ads', conversionRate: 21, leads: 142, pipelineValue: 318000 },
  { name: 'Google Ads', conversionRate: 17, leads: 98, pipelineValue: 241000 },
  { name: 'Referral', conversionRate: 26, leads: 54, pipelineValue: 198000 },
  { name: 'Website', conversionRate: 12, leads: 71, pipelineValue: 96000 },
];

/** A surfaced insight card. */
export interface Insight {
  type: 'positive' | 'warning' | 'info';
  title: string;
  detail: string;
  action: string;
}

/**
 * Build the live insight list exactly as the prototype's
 * PAGES['ai-insights'] does: MoM revenue delta, FTA benchmark, top-vs-bottom
 * practice converter, best source, and the lab-cost trend note.
 */
export function buildInsights(): Insight[] {
  const series = MONTHLY_SERIES;
  const latest = series[series.length - 1];
  const prev = series[series.length - 2];
  const insights: Insight[] = [];

  const revenueDelta = ((latest.revenue - prev.revenue) / prev.revenue) * 100;
  if (Math.abs(revenueDelta) > 8) {
    insights.push({
      type: revenueDelta > 0 ? 'positive' : 'warning',
      title: `Revenue ${revenueDelta > 0 ? 'jumped' : 'dropped'} ${Math.abs(revenueDelta).toFixed(1)}% MoM`,
      detail: `${formatPoundsCompact(latest.revenue)} vs ${formatPoundsCompact(prev.revenue)} last month. ${
        revenueDelta > 0
          ? 'Investigate what drove the lift so you can repeat it.'
          : 'Worth digging into which practices and treatments slowed.'
      }`,
      action: 'Review P&L',
    });
  }

  // FTA fixed at the prototype's demo figure (4.2%, below the 8% UK avg).
  const ftaRate = 4.2;
  insights.push({
    type: ftaRate > 8 ? 'warning' : 'positive',
    title: `FTA rate at ${ftaRate.toFixed(1)}% — ${ftaRate > 8 ? 'above' : 'better than'} UK avg of 8%`,
    detail:
      ftaRate > 8
        ? 'Failed-to-attend creeping up. Review reminder cadence and pre-pay deposits.'
        : 'Below benchmark. Whatever you are doing with reminders is working — document and replicate.',
    action: ftaRate > 8 ? 'Adjust reminders' : 'Document process',
  });

  const sorted = [...PRACTICE_SUMMARY].sort((a, b) => b.conversionRate - a.conversionRate);
  const top = sorted[0];
  const bottom = sorted[sorted.length - 1];
  insights.push({
    type: 'info',
    title: `${top.name} converting ${top.conversionRate}% vs ${bottom.name} at ${bottom.conversionRate}%`,
    detail: `${(top.conversionRate - bottom.conversionRate).toFixed(
      1
    )}pp gap. Run a process review at ${bottom.name} — what is ${top.name} doing differently with consults?`,
    action: 'Schedule review',
  });

  const bestSource = [...SOURCE_SUMMARY].sort((a, b) => b.conversionRate - a.conversionRate)[0];
  insights.push({
    type: 'positive',
    title: `${bestSource.name} converting at ${bestSource.conversionRate}%`,
    detail: `Highest-converting source last 30 days. ${formatPoundsCompact(
      bestSource.pipelineValue
    )} pipeline value from ${bestSource.leads} leads. Worth scaling spend on this channel.`,
    action: 'Scale this',
  });

  insights.push({
    type: 'warning',
    title: 'Lab cost trending 16% vs 15% target',
    detail:
      'Group-wide lab spend up 1pp this quarter. Mostly from Warwick Lodge implant volume. Consider routing more cases through GM Dental Lab to recapture margin.',
    action: 'Review lab mix',
  });

  return insights;
}

/**
 * Three-month forward projection appended to the last 6 actual months,
 * seasonality-adjusted exactly as the prototype's inline IIFE does.
 */
export function buildProjection(): MonthPoint[] {
  const series = MONTHLY_SERIES;
  const last3Avg = series.slice(-3).reduce((s, m) => s + m.revenue, 0) / 3;
  // Monthly seasonal factors, Jan..Dec, lifted verbatim from the prototype.
  const SEASON = [1.3, 1.15, 1.1, 1.05, 1.1, 1.05, 0.95, 0.75, 1.25, 1.2, 1.1, 0.8];
  const proj: MonthPoint[] = [];
  for (let i = 0; i < 3; i++) {
    const d = new Date();
    d.setMonth(d.getMonth() + i + 1);
    const baseRev = last3Avg * SEASON[d.getMonth()];
    proj.push({
      month: d.toISOString().slice(0, 7),
      revenue: Math.round(baseRev),
      profit: Math.round(baseRev * 0.1),
    });
  }
  return [...series.slice(-6), ...proj];
}

/** A chat starter button shown in the Plan4Growth AI empty state. */
export const P4G_STARTERS = [
  "What's my revenue last month?",
  'How many leads did I get this month?',
  "What's my conversion rate?",
  'How much pipeline value do I have?',
] as const;

/**
 * Canned Plan4Growth AI reply for a free-text question. Mirrors the
 * prototype's generateP4GAIResponse keyword routing (revenue / leads /
 * conversion / pipeline / FTA / practice / greeting / fallback).
 */
export function answerP4G(question: string): string {
  const q = question.toLowerCase();

  if (q.includes('revenue')) {
    return 'Your monthly revenue for the last 30 days is £245,000, up 8% on the previous month. EBITDA margin sits at 46%, which is above the 35% UK dental practice benchmark.';
  }
  if (q.includes('lead') && (q.includes('how many') || q.includes('total') || q.includes('this month'))) {
    return "You've had 312 new leads in the last 30 days. 118 have booked a consultation. Top source: Meta Lead Ads.";
  }
  if (q.includes('conversion')) {
    return 'Your lead-to-treatment conversion rate is 19.2% over the last 30 days. The UK private dental benchmark is around 18-22%, so you are tracking well. Single Tooth Implants are converting at the highest rate.';
  }
  if (q.includes('pipeline')) {
    const value = SOURCE_SUMMARY.reduce((s, x) => s + x.pipelineValue, 0);
    return `Your active pipeline value is ${formatPounds(
      value
    )} across 312 leads. The biggest concentration is in All-on-4 cases at Warwick Lodge — three leads worth £43,500 combined.`;
  }
  if (q.includes('fta') || q.includes('miss')) {
    return 'Your failed-to-attend rate is currently 4.2%, which is below the 8% UK average. Most FTAs are happening on Monday morning slots — worth reviewing your reminder cadence for those.';
  }
  if (q.includes('practice') || q.includes('site')) {
    return 'Across your 5 practices, Warwick Lodge Implant Centre is producing the highest revenue per chair at £18,200/month. Barnet Dental has the lowest at £8,400/month — worth investigating whether it is a marketing or capacity issue.';
  }
  if (q.includes('hello') || q.includes('hi ') || q === 'hi') {
    return 'Hi. I can answer questions about revenue, leads, conversion, pipeline value, FTA rates, practice performance, and more. Just ask in plain English.';
  }
  return "I'd answer that with live data from your ledger and CRM in production. Try asking me about revenue, leads, conversion rate, pipeline value, or FTA rate — those are wired up in this demo.";
}
