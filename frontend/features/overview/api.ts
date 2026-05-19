import { api } from '@/lib/api';
import type { MonthPoint, PracticeStat, SourceStat, Insight } from './data';

// Backend returns integer pence; the overview screens work in whole pounds
// (formatPounds / @/features/_mock). Convert at this boundary only.
const toPounds = (pence: number) => Math.round((pence || 0) / 100);

export interface SeriesResult {
  error?: string;
  series: MonthPoint[];
}

export async function getRevenueSeries(): Promise<SeriesResult> {
  const r = await api('/api/analytics/revenue-series?months=12');
  if (r?.error) return { error: r.error, series: [] };
  return {
    series: (r.months ?? []).map((m: any) => ({
      month: m.month,
      revenue: toPounds(m.revenue),
      profit: toPounds(m.profit),
    })),
  };
}

// Button-triggered: Claude analyses live data → insight cards. On any
// failure/no-data returns empty + error so the screen falls back to the
// deterministic rule-based insights.
export async function generateAiInsights(): Promise<{
  insights: Insight[];
  error?: string;
}> {
  const r = await api('/api/analytics/ai-insights/generate', {
    method: 'POST',
  });
  return { insights: r?.insights ?? [], error: r?.error };
}

export interface InsightsResult {
  practices: PracticeStat[];
  sources: SourceStat[];
  truncated: boolean;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

// Real Plan4Growth AI chat. Backend injects the org's business context
// (baseline/targets/snapshot) server-side; we send the message + prior turns.
export async function sendP4gChat(
  message: string,
  history: ChatTurn[],
): Promise<string> {
  const r = await api('/api/p4g-ai/chat', {
    method: 'POST',
    body: JSON.stringify({ message, history }),
  });
  return r?.reply ?? '';
}

export async function getAiInsights(): Promise<InsightsResult> {
  const r = await api('/api/analytics/ai-insights?days=30');
  return {
    truncated: !!r?.truncated,
    practices: (r?.practices ?? []).map((p: any) => ({
      name: p.name,
      conversionRate: p.conversionRate ?? 0,
      revenue30d: toPounds(p.revenue30dPence),
    })),
    sources: (r?.sources ?? []).map((s: any) => ({
      name: s.name,
      conversionRate: s.conversionRate ?? 0,
      leads: s.leads ?? 0,
      pipelineValue: toPounds(s.pipelineValuePence),
    })),
  };
}
