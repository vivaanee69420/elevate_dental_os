// Overview section — pure transforms + P4G starter labels.
//
// The synthetic MONTHLY_SERIES / PRACTICE_SUMMARY / SOURCE_SUMMARY constants
// were deleted: AI Insights now fetches real data (see ./api.ts ←
// /api/analytics/revenue-series + /api/analytics/ai-insights). buildInsights
// and buildProjection are now PURE functions over fetched data — no module
// state. /p4g-ai is wired to the real endpoint; only P4G_STARTERS remain.
//
// Convention: amounts here are WHOLE POUNDS (api.ts converts pence→pounds at
// the fetch boundary, matching @/features/_mock's formatPounds).

import { formatPoundsCompact } from '@/features/_mock';

/** One month of group revenue/profit. Whole pounds. */
export interface MonthPoint {
  /** ISO month key, e.g. "2025-11". */
  month: string;
  revenue: number;
  profit: number;
}

/** Per-practice 30-day rollup used by the insight cards. */
export interface PracticeStat {
  name: string;
  conversionRate: number; // percentage points
  revenue30d: number; // whole pounds
}

/** Per-source 30-day rollup used by the "best source" insight. */
export interface SourceStat {
  name: string;
  conversionRate: number; // percentage points
  leads: number;
  pipelineValue: number; // whole pounds
}

/** A surfaced insight card. */
export interface Insight {
  type: 'positive' | 'warning' | 'info';
  title: string;
  detail: string;
  action: string;
}

/**
 * Build the live insight list from fetched data. Same shape as the prototype
 * (MoM revenue delta, top-vs-bottom practice converter, best source) but each
 * section is guarded so an empty/short dataset degrades instead of throwing.
 *
 * NOTE: the FTA and lab-cost cards are still static copy — there is no real
 * FTA / lab-spend feed yet (tracked as a follow-up, not fabricated per-org).
 */
export function buildInsights(
  series: MonthPoint[],
  practices: PracticeStat[],
  sources: SourceStat[],
): Insight[] {
  const insights: Insight[] = [];

  if (series.length >= 2) {
    const latest = series[series.length - 1];
    const prev = series[series.length - 2];
    const revenueDelta =
      prev.revenue > 0
        ? ((latest.revenue - prev.revenue) / prev.revenue) * 100
        : 0;
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
  }

  // Static benchmark copy (no real FTA feed yet — follow-up).
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

  if (practices.length >= 2) {
    const sorted = [...practices].sort(
      (a, b) => b.conversionRate - a.conversionRate,
    );
    const top = sorted[0];
    const bottom = sorted[sorted.length - 1];
    insights.push({
      type: 'info',
      title: `${top.name} converting ${top.conversionRate}% vs ${bottom.name} at ${bottom.conversionRate}%`,
      detail: `${(top.conversionRate - bottom.conversionRate).toFixed(
        1,
      )}pp gap. Run a process review at ${bottom.name} — what is ${top.name} doing differently with consults?`,
      action: 'Schedule review',
    });
  }

  if (sources.length > 0) {
    const bestSource = [...sources].sort(
      (a, b) => b.conversionRate - a.conversionRate,
    )[0];
    insights.push({
      type: 'positive',
      title: `${bestSource.name} converting at ${bestSource.conversionRate}%`,
      detail: `Highest-converting source last 30 days. ${formatPoundsCompact(
        bestSource.pipelineValue,
      )} pipeline value from ${bestSource.leads} leads. Worth scaling spend on this channel.`,
      action: 'Scale this',
    });
  }

  return insights;
}

/**
 * Three-month forward projection appended to the last 6 actual months,
 * seasonality-adjusted (factors lifted verbatim from the prototype). Pure
 * over the passed series; empty series → empty result.
 */
export function buildProjection(series: MonthPoint[]): MonthPoint[] {
  if (series.length === 0) return [];
  const last3Avg =
    series.slice(-3).reduce((s, m) => s + m.revenue, 0) /
    Math.min(3, series.length);
  const marginFrac =
    series[series.length - 1].revenue > 0
      ? series[series.length - 1].profit / series[series.length - 1].revenue
      : 0.1;
  const SEASON = [1.3, 1.15, 1.1, 1.05, 1.1, 1.05, 0.95, 0.75, 1.25, 1.2, 1.1, 0.8];
  const proj: MonthPoint[] = [];
  for (let i = 0; i < 3; i++) {
    const d = new Date();
    d.setMonth(d.getMonth() + i + 1);
    const baseRev = last3Avg * SEASON[d.getMonth()];
    proj.push({
      month: d.toISOString().slice(0, 7),
      revenue: Math.round(baseRev),
      profit: Math.round(baseRev * marginFrac),
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
