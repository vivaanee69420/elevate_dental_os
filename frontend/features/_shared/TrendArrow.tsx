'use client';
// ============================================================================
// The trend arrow — ONE definition, used everywhere the app shows which way a
// figure moved.
//
// A rising or falling zigzag ending in a head, the way a financial chart draws
// a trend: it reads as "the line moved" rather than "something points that
// way". It replaced ▲ / ▼ / – , which had themselves replaced ↑↓ because the
// arrow CHARACTERS render thin enough in the system stack to be missed at a
// glance — but the triangles answered that by being blunt rather than legible,
// and a glyph inherits whatever weight and baseline the font gives it. An SVG
// has neither problem: the same shape in every font stack, on the baseline
// because we put it there, with its own stroke weight.
//
// COLOUR IS NOT DECIDED HERE, and it is not simply green-up / red-down. The
// caller passes the tone, which comes from the metric's POLARITY: a rising cost
// per patient is a RED rising trend, because the line really did go up and a
// rise in what a patient costs you is bad news. Direction as the number moved,
// colour as the metric means. See features/marketing/_shared/compare.ts.
// ============================================================================

import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

export type TrendDirection = 'up' | 'down' | 'flat';

export function TrendArrow({ direction, size = 14 }: { direction: TrendDirection; size?: number }) {
  const Icon = direction === 'up' ? TrendingUp : direction === 'down' ? TrendingDown : Minus;
  return (
    <Icon size={size} strokeWidth={2.75} aria-hidden="true"
      className="inline-block shrink-0 relative -top-px" />
  );
}

/** The arrow plus its text on one line, for a sub-line or a tag. */
export function TrendTag({
  direction, children, size = 14, className = '',
}: {
  direction: TrendDirection; children: React.ReactNode; size?: number; className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-1 align-middle ${className}`}>
      <TrendArrow direction={direction} size={size} />
      {children}
    </span>
  );
}
