'use client';
// ============================================================================
// Business Hub — the section chrome every source panel on the page is built
// from: the titled divider above a panel, and the headline scorecard tile
// inside it.
//
// Extracted from GroupPerformanceScreen so the QuickBooks panel uses THESE
// components rather than a lookalike. It previously carried its own tiles, and
// the difference showed: values rendered in the serif `.display` face while
// every Dentally, Marketing and GoHighLevel tile beside them used sans
// `tabular-nums`, so one panel on the page read in a different typeface from
// the rest. A copy is free to drift; there is now one definition.
// ============================================================================

import Link from 'next/link';
import { Chip, type ChipColour } from '@/components/ui';
import { DeltaBadge } from '@/features/marketing/_shared/DeltaBadge';
import { computeDelta, pointsDelta, type Polarity } from '@/features/marketing/_shared/compare';

const DASH = '—';

// n/d as a percentage, rounded to `dp` decimals (default integer). 0 when d<=0.
function pctOf(n: number, d: number, dp = 0): number {
  if (d <= 0) return 0;
  const f = 10 ** dp;
  return Math.round((n / d) * 100 * f) / f;
}

// The delta chip is SHARED with the ad reports rather than rewritten here: it
// already separates arrow-direction from colour-polarity (a rising no-show rate
// is a RED up-arrow), renders an unknowable delta as "no comparison" instead of
// 0%, and says "new" rather than an infinite percentage against a zero base.
// A second copy would be a second set of those judgements, free to drift.

export type HeadlineKpi = {
  label: string; value: string; sub: string; chip: { text: string; tone: ChipColour } | null;
  // Optional click-to-expand affordance (used by Treatments Accepted -> per-practice breakdown).
  onClick?: () => void; hint?: string; active?: boolean;
  // Optional navigation: clicking the tile routes to a detail page (scope/period
  // query already appended). Mutually exclusive with onClick.
  href?: string;
  // Where this figure can be checked in the source system, shown on hover only.
  // Cards the owner cannot verify are cards the owner stops trusting, and the
  // two money cards here were previously computed on a filter Dentally has no
  // equivalent of — so their totals appeared in no Dentally screen at all.
  source?: string;
  // Optional period-over-period comparison, rendered under the chip. `previous`
  // is null when that figure is unknowable for the prior window (a no-show rate
  // with no appointments behind it), which reads as "no comparison" rather than
  // a confident 0%.
  compare?: {
    current: number | null; previous: number | null;
    polarity: Polarity; format: (n: number) => string;
    /** True when the card's own value is a percentage, so the change is
     *  measured in percentage points rather than as a percent of a percent. */
    isRate?: boolean;
  };
};

// Source-group title above a row of headline cards (Dentally, QuickBooks, …).
// Rendered as a titled divider at the top of each section panel.
export function SectionLabel({ children }: { children: string }) {
  return (
    <div className="text-sm font-semibold uppercase tracking-wide text-ink mb-3 pb-2 border-b border-border">
      {children}
    </div>
  );
}

// One headline scorecard tile: label, big value, sub-line, optional status chip.
// When `onClick` is set the whole tile becomes a button (click-to-expand a
// breakdown), with a hover state, an `active` ring while open, and a hint line.
export function HeadlineCard({ c }: { c: HeadlineKpi }) {
  const body = (
    <>
      <div className="text-xs text-ink-muted uppercase tracking-wide" title={c.source}>
        {c.label}
        {c.source && <span className="ml-1 text-ink-muted/70 normal-case" aria-hidden="true">ⓘ</span>}
      </div>
      <div className="text-xl font-bold tabular-nums tracking-tight mt-1">{c.value}</div>
      <div className="text-xs text-ink-muted mt-1">{c.sub}</div>
      {c.chip && <div className="mt-2"><Chip colour={c.chip.tone}>{c.chip.text}</Chip></div>}
      {c.compare && (
        <DeltaBadge
          delta={(c.compare.isRate ? pointsDelta : computeDelta)(c.compare.current, c.compare.previous, c.compare.polarity)}
          previousLabel={c.compare.previous == null ? DASH : c.compare.format(c.compare.previous)}
        />
      )}
      {c.hint && <div className="text-[11px] text-brand mt-2">{c.hint}</div>}
    </>
  );
  // Navigation tile: routes to a detail page (scope/period preserved on the href).
  if (c.href) {
    return (
      <Link href={c.href}
        className="card-padded flex flex-col min-w-0 text-left transition-colors hover:border-brand-200 cursor-pointer">
        {body}
      </Link>
    );
  }
  if (!c.onClick) return <div className="card-padded flex flex-col min-w-0">{body}</div>;
  return (
    <button type="button" onClick={c.onClick} aria-expanded={c.active}
      className={'card-padded flex flex-col min-w-0 text-left transition-colors hover:border-brand-200 '
        + (c.active ? 'ring-1 ring-brand border-brand' : '')}>
      {body}
    </button>
  );
}

