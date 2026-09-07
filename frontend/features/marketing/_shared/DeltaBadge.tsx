'use client';
// The arrow-and-percentage chip a card shows under its headline figure when a
// comparison period is switched on.
//
// Direction and colour are decided in ./compare.ts, not here — see that
// file's header for why a rising cost per patient is a RED up-arrow rather
// than a green one. This component only renders the verdict it is handed.
//
// A null delta renders as an em dash with the reason beside it, never as
// "0%": the two say different things, and the whole point of the comparison
// is that the reader can trust the number next to the arrow.
import { TrendArrow as Arrow } from '@/features/_shared/TrendArrow';
import type { Delta } from './compare';

// No dark-mode variants: rule 1, light only.
const TONE_CLASS: Record<Delta['tone'], string> = {
  good: 'text-emerald-700',
  bad: 'text-red-700',
  neutral: 'text-ink-muted',
};

export function DeltaBadge({
  delta, previousLabel,
}: {
  /** null when the two periods are not comparable — see computeDelta. */
  delta: Delta | null;
  /** The previous period's own value, already formatted (e.g. "£437.10").
   *  Shown beside the percentage so the reader can see what the change is
   *  measured against instead of taking the percentage on trust. */
  previousLabel: string;
}) {
  if (!delta) {
    return (
      <p className="mt-1 text-[11.5px] text-ink-muted">
        — no comparison (nothing to measure against)
      </p>
    );
  }

  const pct = delta.pct === null
    // "was zero, now isn't". An infinite rise has no percentage; saying so
    // beats printing a number that cannot be right.
    ? 'new'
    // A points move is an absolute change in a figure that is already a
    // percentage, so it is labelled "pp": "▼ 0.6 pp" beside a headline of
    // "5.6%" is checkable, where a bare "▼ 0.6%" invites the reader to
    // subtract it from the value above.
    : `${Math.abs(delta.pct).toFixed(1)}${delta.unit === 'points' ? ' pp' : '%'}`;

  return (
    <p className={`mt-1 text-[11.5px] flex items-center gap-1 flex-wrap ${TONE_CLASS[delta.tone]}`}>
      <Arrow direction={delta.direction} />
      <span className="font-semibold">{pct}</span>
      <span className="text-ink-muted">vs {previousLabel}</span>
    </p>
  );
}

/**
 * The same verdict, sized for a table cell: arrow and percentage only, under
 * the value it describes. No "vs …" — a per-practice table already has one
 * row per practice and repeating the previous value in every cell would
 * double the width of a table that already scrolls.
 *
 * Renders nothing at all when there is no comparison to make, rather than an
 * em dash: in a grid of numbers a dash reads as "zero" or "missing metric",
 * and the cell above it already carries the real value.
 */
export function DeltaInline({ delta }: { delta: Delta | null }) {
  if (!delta) return null;
  const pct = delta.pct === null ? 'new' : `${Math.abs(delta.pct).toFixed(1)}%`;
  // Stays a BLOCK whose inner row is inline-flex, so the arrow and figure sit
  // on their own line but still follow the cell's own text alignment. A flex
  // container with a fixed justification here would drag the badge to one side
  // of every left-aligned cell it appears in.
  return (
    <span className={`block text-[11px] leading-tight ${TONE_CLASS[delta.tone]}`}>
      <span className="inline-flex items-center gap-0.5 align-middle">
        <Arrow direction={delta.direction} size={12} />
        {pct}
      </span>
    </span>
  );
}
