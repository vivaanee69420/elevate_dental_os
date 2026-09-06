// Period-on-period comparison for the ad-report cards: the date arithmetic
// that builds a comparison window, and the delta maths that decides which
// way the arrow points and what colour it is.
//
// ============================================================================
// ARROW DIRECTION AND ARROW COLOUR ARE TWO DIFFERENT QUESTIONS.
//
// The arrow points the way the number moved: up when it went up, down when it
// went down. That part is literal and never varies.
//
// The COLOUR says whether that movement is good news, and for three of the
// four cards on this page it is the OPPOSITE of the naive reading. Cost per
// lead, cost per booking and cost per accepted patient are all costs: paying
// £516 per patient this month against £437 last month is a rise, and a rise
// in what a patient costs you is bad. Painting that green because the number
// went up would have the card congratulate the practice for getting worse —
// the single most misleading thing a dashboard can do, because it is read at
// a glance and believed.
//
// So: ▲ 18.2% on CPA renders RED, ▼ 8.1% on CPA renders GREEN. Direction as
// asked; colour as the metric actually means.
//
// Spend is NEUTRAL, deliberately. It is an input the practice controls, not
// an outcome: spending more is neither good nor bad on its own, and colouring
// it either way asserts a judgement the number cannot support. It gets an
// arrow and a percentage in plain ink.
//
// ============================================================================
// A PERCENTAGE CHANGE IS NOT ALWAYS DEFINED, AND MUST NOT BE INVENTED.
//
// Every branch below that returns null is a case where there is no honest
// percentage to show, and the badge renders an em dash or the word "new"
// instead of a number. Enumerated rather than left to `(a - b) / b` because
// that expression yields Infinity, NaN and -100% for three cases that mean
// quite different things, and all three render as confident text:
//
//   * either side unknown (null) — cost per nothing, an empty period. NOT 0%.
//   * previous zero, current positive — an infinite rise. "new", not "∞%".
//   * both zero — nothing happened. Flat, 0%.
//   * previous positive, current zero — a real, finite -100%.
//   * previous negative — paid figures are net of refunds and CAN go below
//     zero; a percentage against a negative base is meaningless, so null.
// ============================================================================

// ============================================================================
// TWO PERIODS ARE NOT AUTOMATICALLY COMPARABLE.
//
// Measured on live data while building this: Plan4growth has 2,733 leads in
// March-May 2026 and NOT ONE of them is in a GoHighLevel pipeline mapped to
// Google — the mapping only begins in June. So the default "previous 92 days"
// comparison put 3 accepted patients against 44, and the cost-per-patient
// card would have rendered "▼ 95.2%" IN GREEN: a five-figure improvement that
// never happened, caused entirely by attribution coverage starting mid-window.
//
// A percentage between two periods is only a performance figure if both
// periods were measured the same way. When one period is missing a lead
// SOURCE the other has, they were not, and no amount of arithmetic fixes it.
// sourcesComparable() below is the cheapest honest test available from data
// the page has already fetched: does each source either appear in both
// periods or in neither.
//
// When it returns false the caller keeps the ARROW — the number really did
// move that way — but drops the good/bad colour, because "good" is a claim
// about performance and performance is exactly what cannot be read here.
// ============================================================================

export interface SourceCounts {
  ghl: number;
  callrail: number;
}

/**
 * Whether two periods drew leads from the same set of sources, and so can be
 * compared as performance rather than merely differenced.
 *
 * Presence, not proportion: a period with 218 GoHighLevel leads against one
 * with 12 is a real and interesting change, and calling that incomparable
 * would suppress precisely the signal the feature exists to show. A period
 * with 218 against one with ZERO is a coverage cliff, not a collapse in
 * demand.
 */
export function sourcesComparable(a: SourceCounts, b: SourceCounts): boolean {
  return (a.ghl > 0) === (b.ghl > 0) && (a.callrail > 0) === (b.callrail > 0);
}

/** Names the sources present in `have` but entirely absent from `missing`. */
export function missingSources(have: SourceCounts, missing: SourceCounts): string[] {
  const out: string[] = [];
  if (have.ghl > 0 && missing.ghl === 0) out.push('GoHighLevel');
  if (have.callrail > 0 && missing.callrail === 0) out.push('CallRail');
  return out;
}

/** Which direction is good for a given metric — see the file header. */
export type Polarity = 'higher-better' | 'lower-better' | 'neutral';

export type Tone = 'good' | 'bad' | 'neutral';

export interface Delta {
  /** Which way the number moved. 'flat' when it did not move at all. */
  direction: 'up' | 'down' | 'flat';
  /** Signed percentage change, or null when there is no honest one to show
   *  (see the file header). A null here with direction 'up' is the
   *  "was zero, now isn't" case the badge labels "new". */
  pct: number | null;
  /** What colour the badge should be, after applying the metric's polarity. */
  tone: Tone;
  /** How to read `pct`. 'percent' is a proportional change; 'points' is an
   *  absolute move in a figure that is ALREADY a percentage. The badge prints
   *  the unit, because "▼ 0.6" means nothing without it. */
  unit: 'percent' | 'points';
}

// ---------------------------------------------------------------------------
// Date arithmetic.
//
// Windows here are plain YYYY-MM-DD strings with BOTH ends inclusive — the
// shape ymdWindowParams already produces and GoogleQuerySchema already
// requires. All arithmetic goes through Date.UTC on the calendar parts, never
// on instants: ./window.ts's header documents at length why subtracting
// 86_400_000ms from a London day is wrong twice a year, and this file must not
// reintroduce it by the back door.

function toUtcMs(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function toYmd(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

const DAY_MS = 86_400_000;

/** Days in an inclusive [since, until] window. Same day both ends = 1. */
export function inclusiveDays(since: string, until: string): number {
  return Math.round((toUtcMs(until) - toUtcMs(since)) / DAY_MS) + 1;
}

/**
 * The equal-length window ending the day before this one starts.
 *
 * Equal LENGTH rather than "the previous calendar month": the selected period
 * is whatever the scope bar produced, and comparing 92 days against a 30-day
 * month would put a ratio of periods into a figure the reader will take as a
 * ratio of performance.
 */
export function previousPeriod(since: string, until: string): { since: string; until: string } {
  const len = inclusiveDays(since, until);
  const prevUntilMs = toUtcMs(since) - DAY_MS;
  return {
    since: toYmd(prevUntilMs - (len - 1) * DAY_MS),
    until: toYmd(prevUntilMs),
  };
}

// ---------------------------------------------------------------------------
// Delta maths.

function toneFor(direction: Delta['direction'], polarity: Polarity): Tone {
  if (direction === 'flat' || polarity === 'neutral') return 'neutral';
  const isRise = direction === 'up';
  return (polarity === 'higher-better') === isRise ? 'good' : 'bad';
}

/**
 * Compare one metric across two periods. Returns null when the two are not
 * comparable at all — which is a different statement from "no change", and
 * the caller must render it differently.
 */
export function computeDelta(
  current: number | null | undefined,
  previous: number | null | undefined,
  polarity: Polarity,
): Delta | null {
  // Unknown on either side. Reached whenever a cost has a zero denominator
  // (perUnitPence returns null, never 0 — a cost per nothing is unknowable,
  // not free) or a period returned no totals at all. Treating either as 0
  // would manufacture a 100% swing out of missing data.
  if (current === null || current === undefined) return null;
  if (previous === null || previous === undefined) return null;

  // A percentage against a negative base has no meaning anyone would read
  // correctly. Reachable: a lead's paid figure is net of refunds.
  if (previous < 0) return null;

  if (previous === 0) {
    // Nothing to nothing. Genuinely flat, and 0% is the honest figure.
    if (current === 0) return { direction: 'flat', pct: 0, tone: 'neutral', unit: 'percent' };
    // Something from nothing: the rise is infinite, so there is no
    // percentage. The direction is still real, and the badge says "new".
    return { direction: 'up', pct: null, tone: toneFor('up', polarity), unit: 'percent' };
  }

  if (current === previous) return { direction: 'flat', pct: 0, tone: 'neutral', unit: 'percent' };

  const pct = ((current - previous) / previous) * 100;
  const direction: Delta['direction'] = current > previous ? 'up' : 'down';
  return { direction, pct, tone: toneFor(direction, polarity), unit: 'percent' };
}

/**
 * Compare a metric that is ITSELF a percentage, in percentage points.
 *
 * A no-show rate moving 6.2% -> 5.6% is a fall of 0.6 POINTS. computeDelta
 * would report -9.7%, which is arithmetically correct and unreadable on a card
 * whose headline value is "5.6%": the two percentages are measuring different
 * things and nothing on screen says so. Points are the figure a reader can
 * actually check against the number above them.
 *
 * Zero is treated as a real value here, not as an absent denominator. A
 * practice that missed no appointments genuinely had a 0% rate, so a rise from
 * it is 3.7 points — not the "new" that computeDelta reports for a zero base,
 * which exists because there is no such thing as a percentage of nothing.
 * Unknowable stays null: a rate with no appointments behind it is absent, and
 * the caller must render that as "no comparison".
 */
export function pointsDelta(
  current: number | null | undefined,
  previous: number | null | undefined,
  polarity: Polarity,
): Delta | null {
  if (current === null || current === undefined) return null;
  if (previous === null || previous === undefined) return null;

  // Rounded before the comparison, so a float artefact cannot render as a
  // "change" of 0.0000001 points with a confident arrow beside it.
  const pct = Math.round((current - previous) * 10) / 10;
  if (pct === 0) return { direction: 'flat', pct: 0, tone: 'neutral', unit: 'points' };
  const direction: Delta['direction'] = pct > 0 ? 'up' : 'down';
  return { direction, pct, tone: toneFor(direction, polarity), unit: 'points' };
}
