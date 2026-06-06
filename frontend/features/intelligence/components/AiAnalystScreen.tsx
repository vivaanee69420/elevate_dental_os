'use client';

// AI Analyst (GM Intelligence OS). An Ask box plus prioritised, quantified
// findings ranked by £ impact, all from the CURRENT scope/period's live numbers.
//
// WIRED: POST /api/analytics/ai-ask. Findings aggregate the REAL Decision-Lens
// insights from the P&L / Marketing / Clinicians / Cash rollups (no fabrication);
// the Ask box returns a Claude natural-language answer when a model is configured,
// else a graceful keyword-matched fallback over the same real findings.

import { useState } from 'react';
import { PageHeader, EmptyState, SkeletonText } from '@/components/ui';
import { ScopePeriodBar } from '@/features/_shared/ScopePeriodBar';
import { Panel, PanelHead, NoteFoot, Pill } from './os-ui';
import { useAiFindings, useAiAsk } from '../ai-ask-hooks';
import type { AiFinding } from '../ai-ask-api';

export default function AiAnalystScreen() {
  const { data, isLoading, isError, error } = useAiFindings();
  const ask = useAiAsk();
  const [shown, setShown] = useState(4);
  const [question, setQuestion] = useState('');

  const findings = data?.findings ?? [];
  const visible = findings.slice(0, Math.min(shown, findings.length));
  const more = shown < findings.length;

  const submit = () => {
    if (!question.trim()) return;
    ask.mutate(question.trim());
  };

  const res = ask.data;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="AI Analyst" subtitle="Live analysis of the group's numbers — ranked, quantified recommendations that refresh as you change scope and period." />
      <ScopePeriodBar />

      <Panel className="border border-brand/30 bg-brand/[0.04]">
        <PanelHead title="AI Analyst" sub="Reading your live numbers for the current scope and period and ranking what to do next by £ impact. Change scope or period and the analysis re-runs." />
        <div className="flex gap-2.5 flex-wrap">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            placeholder="Ask anything — e.g. how do I lift margin at this practice?"
            className="flex-1 min-w-[220px] text-sm border border-border rounded-xl px-3.5 py-2.5 bg-card"
          />
          <button onClick={submit} disabled={ask.isPending} className="px-5 py-2.5 rounded-xl bg-brand text-white text-sm font-semibold disabled:opacity-60">
            {ask.isPending ? 'Thinking…' : 'Ask'}
          </button>
        </div>
        {ask.isError && <p className="mt-3 text-xs text-danger">Couldn&apos;t reach the analyst: {(ask.error as Error)?.message ?? 'unknown error'}</p>}
        {res && (
          <div className="mt-3.5">
            {res.answer ? (
              <>
                <p className="text-[11px] text-ink-soft mb-2">Analysis based on your live data:</p>
                <p className="text-[13px] leading-relaxed whitespace-pre-line">{res.answer}</p>
              </>
            ) : (
              <p className="text-[11px] text-ink-soft mb-2">{res.note ?? 'Closest matching findings from your live data:'}</p>
            )}
            <div className="mt-2.5">
              {(res.answerFindings ?? []).map((x, i) => <Finding key={i} insight={x} index="✦" />)}
            </div>
          </div>
        )}
      </Panel>

      <Panel>
        <PanelHead title="Prioritised Findings" sub="Computed from the current scope/period data. Ranked by impact — start at the top." right={<Pill tone="info">{visible.length} of {findings.length}</Pill>} />
        {isError ? (
          <EmptyState message={`Couldn't load findings: ${(error as Error)?.message ?? 'unknown error'}`} />
        ) : isLoading ? (
          <div className="space-y-4 mt-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <SkeletonText key={i} lines={2} />
            ))}
          </div>
        ) : findings.length === 0 ? (
          <EmptyState message="Not enough live data in this scope/period to surface findings yet. Connect Xero/Dentally/ads or pick a period with activity." />
        ) : (
          <>
            {visible.map((x, i) => <Finding key={i} insight={x} index={i + 1} />)}
            {more ? (
              <button onClick={() => setShown((s) => s + 4)} className="mt-3 px-4 py-2 rounded-xl border border-border text-sm font-semibold">✦ Show more findings →</button>
            ) : (
              <NoteFoot>That&apos;s the full current read. Switch scope or period — or ask a specific question above — for more.</NoteFoot>
            )}
          </>
        )}
      </Panel>
    </div>
  );
}

function Finding({ insight, index }: { insight: AiFinding; index: number | string }) {
  const TILE: Record<AiFinding['sev'], string> = {
    good: 'bg-success/15 text-success',
    warn: 'bg-warning/15 text-warning',
    bad: 'bg-danger/15 text-danger',
    info: 'bg-info/15 text-info',
  };
  return (
    <div className="flex gap-3 p-3 rounded-xl border border-border bg-bg mb-2 last:mb-0">
      <div aria-hidden className={`w-7 h-7 flex-none rounded-lg grid place-items-center text-[13px] font-bold ${TILE[insight.sev]}`}>{index}</div>
      <div className="min-w-0 flex-1">
        <div className="flex justify-between gap-2 flex-wrap">
          <b className="text-[13px]">{insight.t}</b>
          {insight.v && <Pill tone={insight.sev}>{insight.v}</Pill>}
        </div>
        <p className="mt-1 text-xs text-ink-muted leading-snug">{insight.d}</p>
      </div>
    </div>
  );
}
