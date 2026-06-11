'use client';

// Decision Lens — AI-generated "what to act on now" cards, shared across the
// Group Performance, Marketing ROI, Clinicians and Day surfaces. Fetches the AI
// lens for the active scope/period; when the AI is unavailable (no key, error,
// empty) it renders the caller's deterministic rule-based `fallback`, so the
// card is never blank. A small header shows the basis + a Refresh control.

import type { ReactNode } from 'react';
import { ArrowUpRight, AlertTriangle, TrendingDown, Info, RefreshCw, Sparkles } from 'lucide-react';
import { AlertRow, EmptyState, Chip, type ChipColour } from '@/components/ui';
import { useDecisionLens } from './decision-lens-hooks';
import type { LensSurface, LensTone } from './decision-lens-api';

// A fallback item is the rule-based lens shape each screen already builds.
export interface LensFallbackItem {
  tone: LensTone;
  title: ReactNode;
  body: ReactNode;
  value?: string;
  icon?: ReactNode; // some screens supply their own icon; else derived from tone
}

const TONE_ICON: Record<LensTone, ReactNode> = {
  good: <ArrowUpRight size={16} />,
  warn: <AlertTriangle size={16} />,
  bad: <TrendingDown size={16} />,
  info: <Info size={16} />,
};
const TONE_CHIP: Record<LensTone, ChipColour> = { good: 'emerald', warn: 'amber', bad: 'rose', info: 'slate' };

function timeAgo(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  const m = Math.round(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function DecisionLens({ surface, fallback }: { surface: LensSurface; fallback: LensFallbackItem[] }) {
  const { data, isFetching, refresh } = useDecisionLens(surface);
  const aiItems = data?.basis === 'ai' && data.items.length ? data.items : null;
  const items: LensFallbackItem[] = aiItems ?? fallback;
  const updated = aiItems && data?.generatedAt ? timeAgo(data.generatedAt) : null;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="inline-flex items-center gap-1 text-[11px] text-ink-muted">
          {aiItems ? <><Sparkles size={11} /> AI{updated ? ` · ${updated}` : ''}</> : 'Rule-based'}
        </span>
        <button
          type="button"
          onClick={() => refresh()}
          disabled={isFetching}
          className="inline-flex items-center gap-1 text-[11px] text-brand hover:underline disabled:opacity-50"
        >
          <RefreshCw size={11} className={isFetching ? 'animate-spin' : ''} />
          {isFetching ? 'Thinking…' : 'Refresh'}
        </button>
      </div>
      {items.length === 0 ? (
        <EmptyState message="No standout actions yet." />
      ) : (
        items.map((a, i) => (
          <AlertRow
            key={i}
            tone={a.tone}
            icon={a.icon ?? TONE_ICON[a.tone]}
            title={a.title}
            body={a.body}
            tag={a.value ? <Chip colour={TONE_CHIP[a.tone]}>{a.value}</Chip> : undefined}
          />
        ))
      )}
    </div>
  );
}
