'use client';
// ============================================================================
// Small inline bars, used INSTEAD of extra numeric columns.
//
// The problem these solve: an ad report has more true facts than a table has
// room for. The reflex is to keep adding right-aligned numeric columns until
// the table scrolls sideways and nobody reads past the fourth one. A bar 44
// pixels wide carries a proportion faster than a number does, costs a
// fraction of the width, and — crucially — is comparable DOWN the column at a
// glance, which is the one thing a column of percentages is bad at.
//
// Three rules all three components follow:
//
//  1. A NULL IS NOT A ZERO, AND MUST NOT RENDER AS AN EMPTY BAR. Google does
//     not report impression share for an individual ad; an empty bar there
//     would read as "you never showed", which is a claim nobody measured.
//     Every component here returns an em dash when it has nothing to draw.
//
//  2. THE BAR IS NEVER THE ONLY CHANNEL. Each one is paired with its number,
//     or carries a title attribute, so the information survives for anyone
//     who cannot distinguish the colours or is reading a screenshot.
//
//  3. COLOUR MEANS SOMETHING OR IT IS NOT USED. Brand green = the share you
//     won. Danger = lost to budget. Warning = lost to rank. Gold = money
//     collected. Everything else is ink or a neutral tint. No decorative
//     colour anywhere, because once one bar is coloured for looks the reader
//     stops believing any of them.
// ============================================================================
import { DASH } from './format';

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/**
 * A proportion of the column's own maximum, drawn as a tint behind nothing in
 * particular — used for share of spend, where the question is "which of these
 * rows is big" and the exact figure is already in the cell beside it.
 *
 * Takes `value` and `max` rather than a pre-computed fraction so the caller
 * cannot accidentally normalise against a different denominator per row.
 */
export function ShareBar({ value, max, title }: { value: number; max: number; title?: string }) {
  if (!(max > 0)) return null;
  const pct = clamp01(value / max) * 100;
  return (
    <span
      className="mt-1 block h-[3px] w-full overflow-hidden rounded-full bg-border/60"
      title={title}
      aria-hidden
    >
      <span className="block h-full rounded-full bg-brand/70" style={{ width: `${pct}%` }} />
    </span>
  );
}

/**
 * Impression share as a three-part bar: what you WON, what you lost to
 * BUDGET, what you lost to RANK.
 *
 * This is the component the whole impression-share pull exists for. As three
 * numeric columns the figures are nearly unreadable — they are ratios of a
 * quantity (eligible auctions) that appears nowhere on the page, and the
 * reader has to hold all three in their head to draw the conclusion. As one
 * bar the conclusion IS the picture: a long red segment says raise the
 * budget, a long amber segment says raise the bid or fix the ad. Those are
 * different instructions, and separating them is the entire point.
 *
 * The three segments are rendered in that order and sum to roughly 1 —
 * "roughly" because Google caps a reported share at 0.9 for very high values
 * and rounds each component independently. Any shortfall is left as bare
 * track rather than being padded out to 100%, which would be inventing a
 * fourth category to make the arithmetic tidy.
 */
export function ImpressionShareBar({
  won, lostToBudget, lostToRank,
}: {
  won: number | null;
  lostToBudget: number | null;
  lostToRank: number | null;
}) {
  // Not "won === null": a campaign type that does not compete in the search
  // auction at all (Display, Video, and Performance Max in part) reports none
  // of the three, and drawing an empty track for it says "you won nothing"
  // when the truth is "this was never measured here".
  if (won === null && lostToBudget === null && lostToRank === null) {
    return <span className="text-ink-muted">{DASH}</span>;
  }
  const w = clamp01(won ?? 0);
  const b = clamp01(lostToBudget ?? 0);
  const r = clamp01(lostToRank ?? 0);
  const label = [
    won !== null ? `won ${(w * 100).toFixed(0)}%` : null,
    lostToBudget !== null ? `lost to budget ${(b * 100).toFixed(0)}%` : null,
    lostToRank !== null ? `lost to rank ${(r * 100).toFixed(0)}%` : null,
  ].filter(Boolean).join(' · ');

  return (
    <span className="inline-flex items-center justify-end gap-2" title={label}>
      <span className="flex h-[6px] w-14 overflow-hidden rounded-full bg-border/60">
        <span className="h-full bg-brand" style={{ width: `${w * 100}%` }} />
        <span className="h-full bg-danger/80" style={{ width: `${b * 100}%` }} />
        <span className="h-full bg-warning/70" style={{ width: `${r * 100}%` }} />
      </span>
      <span className="w-9 text-right tabular-nums text-ink">
        {won === null ? DASH : `${(w * 100).toFixed(0)}%`}
      </span>
    </span>
  );
}

/**
 * Leads -> booked -> accepted, as three nested segments of one bar.
 *
 * A funnel is a set of nested subsets, and three separate count columns hide
 * that: 52 / 2 / 1 and 28 / 6 / 5 are hard to compare at a glance even though
 * the second is a far better campaign. Drawn proportionally against the
 * ROW'S OWN lead count, the shape is the answer.
 *
 * Deliberately NOT drawn against the table's largest lead count: this bar
 * answers "how well did this campaign convert", not "how big was it". Size is
 * already carried by the spend column and its ShareBar.
 */
export function FunnelBar({
  leads, booked, accepted,
}: { leads: number; booked: number; accepted: number }) {
  if (leads <= 0) return <span className="text-ink-muted">{DASH}</span>;
  const b = clamp01(booked / leads) * 100;
  const a = clamp01(accepted / leads) * 100;
  return (
    <span
      className="relative block h-[6px] w-full overflow-hidden rounded-full bg-brand/15"
      title={`${leads} leads · ${booked} booked · ${accepted} accepted`}
      aria-hidden
    >
      {/* Stacked, not side by side — accepted is a subset of booked, which is
          a subset of leads, and drawing them adjacent would imply otherwise. */}
      <span className="absolute inset-y-0 left-0 rounded-full bg-brand/45" style={{ width: `${b}%` }} />
      <span className="absolute inset-y-0 left-0 rounded-full bg-brand" style={{ width: `${a}%` }} />
    </span>
  );
}

/**
 * A small status word. Used for campaign/ad state, match type, ad strength
 * and search-term status — all of them short enum labels that would otherwise
 * shout in full caps down a column.
 *
 * `tone` is only ever set where the value carries a real judgement Google
 * itself makes (a disapproved ad, an excluded search term). Everything else
 * is neutral, because colouring "PHRASE" differently from "EXACT" would imply
 * one is better.
 */
export function Chip({
  children, tone = 'neutral',
}: { children: React.ReactNode; tone?: 'neutral' | 'good' | 'bad' | 'muted' }) {
  const cls = {
    neutral: 'border-border bg-bg text-ink-muted',
    muted: 'border-transparent bg-transparent text-ink-muted',
    good: 'border-brand-100 bg-brand-50 text-brand-700',
    bad: 'border-danger/25 bg-danger/10 text-danger',
  }[tone];
  return (
    <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10.5px] font-medium leading-none ${cls}`}>
      {children}
    </span>
  );
}

/** Google's SCREAMING_SNAKE enums, rendered as something a person reads. */
export function humanise(v: string | null | undefined): string | null {
  if (!v) return null;
  return v.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());
}
