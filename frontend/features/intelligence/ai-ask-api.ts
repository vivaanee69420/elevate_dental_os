import { api } from '@/lib/api';

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
}

export function postAiAsk(
  scope: string,
  period: 'month' | 'day',
  pk: string,
  question?: string,
): Promise<AiAskResult> {
  return api<AiAskResult>('/api/analytics/ai-ask', {
    method: 'POST',
    body: JSON.stringify({ scope, period, pk, question: question ?? '' }),
  });
}
