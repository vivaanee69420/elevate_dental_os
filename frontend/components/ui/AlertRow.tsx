// AlertRow — icon tile + bold title + body. Ports the prototype's `.alert`,
// used in Decision Lens, AI Analyst findings, and cashflow decisions.
// Decorative icon is aria-hidden (rule 7 / a11y); meaning is in the text.

import { ReactNode } from 'react';

type AlertTone = 'good' | 'warn' | 'bad' | 'info';

const TILE: Record<AlertTone, string> = {
  good: 'bg-success/15 text-success',
  warn: 'bg-warning/15 text-warning',
  bad: 'bg-danger/15 text-danger',
  info: 'bg-info/15 text-info',
};

interface AlertRowProps {
  tone?: AlertTone;
  /** Decorative icon node (lucide). Rendered aria-hidden. */
  icon?: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  /** Optional right-aligned pill (e.g. the £-impact tag on AI findings). */
  tag?: ReactNode;
}

/** One alert / insight row. Token-driven; see DESIGN.md. */
export function AlertRow({ tone = 'info', icon, title, body, tag }: AlertRowProps) {
  return (
    <div className="flex gap-3 p-3 rounded-xl border border-border bg-bg mb-2 last:mb-0">
      {icon && (
        <div aria-hidden="true" className={`w-8 h-8 flex-none rounded-lg grid place-items-center ${TILE[tone]}`}>
          {icon}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex justify-between gap-2 flex-wrap">
          <b className="text-[13px]">{title}</b>
          {tag}
        </div>
        {body && <p className="mt-1 text-xs text-ink-muted leading-snug">{body}</p>}
      </div>
    </div>
  );
}
