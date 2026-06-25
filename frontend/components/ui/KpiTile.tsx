'use client';

// KpiTile — single headline metric card used across every section.
// Frozen Phase-0 primitive. `delta` slot added centrally after Wave 1
// agents repeatedly needed the prototype's sub-line; additive and
// backward-compatible (existing two-prop callers unaffected).
// `info` slot (optional) adds a "?" toggle that reveals how the metric is
// calculated — also additive; callers that omit it are unaffected.

import { useState, type ReactNode } from 'react';

interface KpiTileProps {
  /** Uppercase metric label, e.g. "Monthly revenue". */
  label: string;
  /** Formatted metric value, e.g. "£412k". */
  value: string;
  /** Optional sub-line under the value (trend / context). */
  delta?: string;
  /** Tone for the delta text. Defaults to muted. */
  deltaTone?: 'up' | 'down' | 'muted';
  /** Optional "how is this calculated" content. When provided, a "?" toggle
   *  appears; clicking it reveals this panel inside the card. */
  info?: ReactNode;
  /** Optional click handler. When provided the whole card becomes interactive
   *  (cursor, hover, keyboard) and a chevron affordance appears — used for
   *  drill-down cards that reveal a breakdown below the grid. Additive: callers
   *  that omit it are unaffected. */
  onClick?: () => void;
  /** When `onClick` is set, marks the card as the open/expanded one (chevron
   *  points down and the card gets a highlighted border). */
  active?: boolean;
}

/** Render one KPI card; shows the delta sub-line only when provided. */
export function KpiTile({ label, value, delta, deltaTone = 'muted', info, onClick, active }: KpiTileProps) {
  const [open, setOpen] = useState(false);
  const toneClass =
    deltaTone === 'up'
      ? 'text-success'
      : deltaTone === 'down'
      ? 'text-danger'
      : 'text-ink-muted';
  const clickable = !!onClick;
  return (
    <div
      className={`card-padded flex flex-col min-w-0${
        clickable
          ? ` cursor-pointer transition hover:shadow-sm ${active ? 'border-brand ring-1 ring-brand/30' : 'hover:border-brand/40'}`
          : ''
      }`}
      {...(clickable
        ? {
            role: 'button' as const,
            tabIndex: 0,
            'aria-expanded': active,
            onClick,
            onKeyDown: (e: React.KeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            },
          }
        : {})}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs text-ink-muted uppercase tracking-wide flex items-center gap-1">
          {label}
          {clickable && (
            <span aria-hidden className="text-ink-muted/70 text-[10px]">{active ? '▾' : '▸'}</span>
          )}
        </div>
        {info && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
            aria-label={open ? 'Hide how this is calculated' : 'How is this calculated?'}
            aria-expanded={open}
            className="shrink-0 w-5 h-5 rounded-full border border-border text-[11px] font-semibold text-ink-muted leading-none flex items-center justify-center hover:bg-surface-muted"
          >
            {open ? '×' : '?'}
          </button>
        )}
      </div>
      <div className="text-xl font-bold tabular-nums tracking-tight mt-1">{value}</div>
      {delta && <div className={`text-xs mt-1 ${toneClass}`}>{delta}</div>}
      {info && open && (
        <div className="text-[11px] text-ink-muted mt-2 pt-2 border-t border-border leading-relaxed">
          {info}
        </div>
      )}
    </div>
  );
}
