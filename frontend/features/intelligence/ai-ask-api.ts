import { api } from '@/lib/api';
import { type ResolvedWindow } from '@/features/_shared/scope-context';

// AI Analyst (GM Intelligence OS) — POST /api/analytics/ai-ask.
// £-ranked findings over the group's LIVE scope/period numbers (aggregated from
// the real P&L / Marketing / Clinicians / Cash rollups) + a natural-language
// answer (Claude) to a free-text question. No question → findings only, no model
// call. Findings use the Insight shape the screen renders.

export interface AiFinding {
  sev: 'good' | 'warn' | 'bad' | 'info';
  t: string;
  d: string;
  v: string;
}

export interface PracticeBreakdownItem {
  name: string;
  cashPence: number;
  productionPence: number;
  revPence: number | null;
  netPence: number | null;
  marginPct: number | null;
}

export interface AiAskResult {
  scope: string;
  period: 'month' | 'day';
  question: string;
  answer: string | null;
  findings: AiFinding[];
  answerFindings?: AiFinding[];
  basis: 'rollups' | 'claude';
  model: string | null;
  note?: string;
  practiceBreakdown?: PracticeBreakdownItem[];
}

export function postAiAsk(scope: string, win: ResolvedWindow, question?: string): Promise<AiAskResult> {
  return api<AiAskResult>('/api/analytics/ai-ask', {
    method: 'POST',
    body: JSON.stringify({ scope, since: win.since, until: win.until, label: win.label, question: question ?? '' }),
  });
}
