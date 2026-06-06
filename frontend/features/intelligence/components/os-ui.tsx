'use client';

// Shared presentational bits for the GM Intelligence OS screens — ports the
// prototype's .panel / .p-head / .note-foot / .pill primitives onto the
// green/gold token system. Kept local to the Intelligence OS feature so the
// frozen components/ui primitives stay untouched.

import { ReactNode } from 'react';

export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`card-padded ${className}`.trim()}>{children}</div>;
}

export function PanelHead({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <div className="flex justify-between items-start gap-3 flex-wrap mb-3">
      <div>
        <h3 className="display text-lg font-semibold">{title}</h3>
        {sub && <p className="text-xs text-ink-muted mt-0.5 max-w-2xl">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

export function NoteFoot({ children }: { children: ReactNode }) {
  return <p className="text-[11px] text-ink-soft leading-relaxed mt-3 pt-3 border-t border-border">{children}</p>;
}

type PillTone = 'good' | 'warn' | 'bad' | 'info';
const PILL: Record<PillTone, string> = {
  good: 'bg-success/15 text-success',
  warn: 'bg-warning/15 text-warning',
  bad: 'bg-danger/15 text-danger',
  info: 'bg-info/15 text-info',
};
export function Pill({ tone = 'info', children }: { tone?: PillTone; children: ReactNode }) {
  return <span className={`inline-block text-[11px] font-semibold px-2.5 py-1 rounded-full ${PILL[tone]}`}>{children}</span>;
}

/** Scope-not-applicable note (Academy/Lab on clinical-only views). */
export function ScopeNote({ title, body }: { title: string; body: string }) {
  return (
    <Panel>
      <PanelHead title={title} sub={body} right={<Pill tone="info">Scope</Pill>} />
    </Panel>
  );
}

export const th = 'text-[11px] uppercase tracking-wider text-ink-muted font-semibold p-2 align-bottom';
export const td = 'p-2 align-top text-[13px]';
export const numCls = (n: number) => (n > 0 ? 'text-success' : n < 0 ? 'text-danger' : '');
