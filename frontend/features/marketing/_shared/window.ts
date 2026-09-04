// Window-building helpers shared by BOTH ad-reporting pages (Facebook's
// hooks.ts, Google's hooks.ts). Both platforms' deep-grain report endpoints
// take the IDENTICAL plain-date, both-ends-inclusive window —
// FacebookQuerySchema and GoogleQuerySchema
// (backend/src/controllers/marketing.controller.js) are two copies of the
// same `/^\d{4}-\d{2}-\d{2}$/` regex plus the same since<=until refine — so
// the client-side conversion from the shared ScopePeriod bar's
// ISO-datetime/half-open window has to be ONE piece of logic too. Two copies
// of DST-sensitive date arithmetic is exactly the kind of thing that drifts
// silently: this file exists so the Facebook and Google pages cannot
// disagree about what a given period's since/until actually are.
//
// This is DELIBERATELY NOT the shared `windowParams(scope, win)` in
// features/_shared/scope-context.tsx, which every other marketing hook uses.
// That helper emits since/until as full ISO datetimes on a HALF-OPEN
// [since, until) window — the shape /api/marketing/performance etc. take.
// Sending that as-is to either ad-reporting endpoint would 400 on every
// request (both schemas reject a non-YYYY-MM-DD string), and even format
// aside, win.until directly would ask for one day too many, since it is the
// EXCLUSIVE start of the day *after* the period, not the last day in it.
//
// Converting the ISO instant to a calendar date with `.slice(0, 10)` is ALSO
// wrong: during BST, London midnight is 23:00 UTC the PREVIOUS day, so
// slicing win.since would silently return yesterday's date for roughly half
// the year. londonDateOf() below reads the calendar date via Intl against
// Europe/London instead — the same technique backend/src/lib/tz.js uses
// server-side — so this agrees with the server regardless of DST.
//
// Deriving the last inclusive day from win.until by subtracting a fixed 24h
// (86_400_000ms) is a DIFFERENT, subtler DST bug: on the UK spring-forward
// Sunday the clocks skip an hour, so that calendar day is only 23 real hours
// end to end, and a 24h instant-subtraction lands a day early. For a
// single-day selection on that Sunday it produces since > until — an
// inverted range matching zero rows, which the service cannot tell apart
// from "never synced" — so a fully synced tenant would be told they have
// never connected the platform. lastInclusiveLondonDay() below does CALENDAR
// arithmetic (subtract 1 from the day field, via Date.UTC) instead of
// INSTANT arithmetic, so it is immune to how many real hours the day was.
//
// The server does not stop at this window either: the deep-grain tables only
// hold a rolling 92 days, so a "year" request is clamped there
// (facebook-report.service.js's/google-report.service.js's shared
// clampWindow) and the clamp is reported back as effectiveSince/windowClamped
// on every payload — that is what lets each page say "showing from X" rather
// than quietly showing less than what the period pill claims.
import type { ResolvedWindow } from '@/features/_shared/scope-context';

// Scope is a bare string: 'all' or a practiceId. Not an object — reading
// `scope.practiceId` would be undefined for every tenant and every request
// would silently go org-wide while the practice pills appeared to work.
// (frontend/features/_shared/scope-context.tsx: `export type Scope = string`.)
export function practiceOf(scope: string | null | undefined): string | null {
  return scope && scope !== 'all' ? scope : null;
}

// en-CA renders as YYYY-MM-DD; explicit options match backend/src/lib/tz.js's
// own YMD formatter rather than relying on en-CA's default shape.
const LONDON_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
});

/** The London calendar date (YYYY-MM-DD) a UTC ISO instant falls in. */
export function londonDateOf(iso: string): string {
  return LONDON_DATE.format(new Date(iso));
}

// The last inclusive day, derived from London CALENDAR parts rather than by
// subtracting 24h from an instant — see the file header for why.
export function lastInclusiveLondonDay(exclusiveUntilIso: string): string {
  const [y, m, d] = londonDateOf(exclusiveUntilIso).split('-').map(Number);
  const prev = new Date(Date.UTC(y, m - 1, d - 1));
  return prev.toISOString().slice(0, 10);
}

/**
 * Builds the query string every Facebook/Google report fetcher takes: plain
 * YYYY-MM-DD since/until (both inclusive) plus practice_id. See the file
 * header for why this cannot be the shared windowParams(scope, win).
 */
export function ymdWindowParams(scope: string, win: ResolvedWindow): string {
  return ymdWindowParamsFor(scope, londonDateOf(win.since), lastInclusiveLondonDay(win.until));
}

/**
 * The same query string, built from an EXPLICIT pair of inclusive
 * YYYY-MM-DD days rather than from the scope bar's window.
 *
 * Used by the cards' comparison period, which the user types or picks and
 * which therefore never passes through ResolvedWindow at all. Routed through
 * one function with ymdWindowParams above so the comparison request cannot
 * end up shaped differently from the request it is being compared against —
 * two periods measured by two slightly different rules is a delta that looks
 * authoritative and means nothing.
 */
export function ymdWindowParamsFor(scope: string, sinceYmd: string, untilYmd: string): string {
  const sp = new URLSearchParams();
  sp.set('since', sinceYmd);
  sp.set('until', untilYmd);
  const practiceId = practiceOf(scope);
  if (practiceId) sp.set('practice_id', practiceId);
  return sp.toString();
}
