'use client';

// ScopePeriod engine — the global Scope + Period state that drives every
// analytics view. State lives in the URL search params (shareable, survives
// navigation); React Query keys include the resolved window so data refetches
// when scope or period change.
//
//   scope : 'all' (= All practices) | <practiceId>   — pill row, data-driven
//   mode  : 'recent' | 'month' | 'year' | 'custom'   — the period pill row
//   mk    : 'YYYY-MM'  (month mode: This month / Pick month)
//   yk    : 'YYYY'     (year mode)
//   cs/cu : 'YYYY-MM-DD' custom range bounds (inclusive)
//
// Every mode resolves to a concrete [since, until) ISO window + human label via
// resolveWindow(); the backend analytics endpoints take that window directly.

import { createContext, useCallback, useContext, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

export type Period = 'month' | 'day'; // legacy alias kept for back-compat
export type PeriodMode = 'recent' | 'month' | 'year' | 'custom';
export type Scope = string; // 'all' | practiceId

export interface ResolvedWindow {
  since: string; // ISO
  until: string; // ISO, exclusive
  label: string;
}

export interface ScopePeriodState {
  scope: Scope;
  mode: PeriodMode;
  monthKey: string; // 'YYYY-MM'
  yearKey: string;  // 'YYYY'
  customSince: string; // 'YYYY-MM-DD'
  customUntil: string; // 'YYYY-MM-DD'
  /** Resolved [since, until) window + label for the active mode. */
  win: ResolvedWindow;
  setScope: (s: Scope) => void;
  setMode: (m: PeriodMode) => void;
  setMonthKey: (k: string) => void;
  setYearKey: (k: string) => void;
  setCustom: (since: string, until: string) => void;
  // Legacy fields — some non-analytics callers still read these.
  period: Period;
  periodKey: string;
}

const ScopePeriodContext = createContext<ScopePeriodState | null>(null);

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Current month 'YYYY-MM' (UTC). */
function currentMonthKey(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}
/** Current year 'YYYY' (UTC). */
function currentYearKey(now = new Date()): string {
  return String(now.getUTCFullYear());
}

// Resolve the active mode to a concrete [since, until) window + label. Bounds are
// day-granular (UTC) so the window — and therefore the React Query key — is
// stable within a calendar day (no refetch churn from millisecond drift).
export function resolveWindow(s: {
  mode: PeriodMode; monthKey: string; yearKey: string; customSince: string; customUntil: string;
}, now = new Date()): ResolvedWindow {
  const isoUTC = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString();
  const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  if (s.mode === 'recent') {
    const until = new Date(todayMs + 86_400_000).toISOString();   // start of tomorrow
    const since = new Date(todayMs - 29 * 86_400_000).toISOString(); // 30 days inclusive
    return { since, until, label: 'Last 30 days' };
  }
  if (s.mode === 'year') {
    const y = Number((s.yearKey || currentYearKey(now)).slice(0, 4)) || now.getUTCFullYear();
    return { since: isoUTC(y, 0, 1), until: isoUTC(y + 1, 0, 1), label: String(y) };
  }
  if (s.mode === 'custom') {
    const cs = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.customSince || '');
    const cu = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.customUntil || '');
    if (cs && cu) {
      const sy = +cs[1], sm = +cs[2] - 1, sd = +cs[3];
      const uy = +cu[1], um = +cu[2] - 1, ud = +cu[3];
      const since = isoUTC(sy, sm, sd);
      const until = new Date(Date.UTC(uy, um, ud) + 86_400_000).toISOString(); // inclusive last day
      const label = `${sd} ${MONTHS_SHORT[sm]} – ${ud} ${MONTHS_SHORT[um]} ${uy}`;
      return { since, until, label };
    }
    // Incomplete custom range → fall back to last 30 days.
    return resolveWindow({ ...s, mode: 'recent' }, now);
  }
  // month
  const mk = /^(\d{4})-(\d{2})$/.exec(s.monthKey || '');
  const y = mk ? +mk[1] : now.getUTCFullYear();
  const m = mk ? +mk[2] - 1 : now.getUTCMonth();
  return { since: isoUTC(y, m, 1), until: isoUTC(y, m + 1, 1), label: `${MONTHS_SHORT[m]} ${y}` };
}

export function ScopePeriodProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const scope: Scope = params.get('scope') || 'all';
  const rawMode = params.get('mode');
  const mode: PeriodMode =
    rawMode === 'month' || rawMode === 'year' || rawMode === 'custom' ? rawMode : 'recent';
  const monthKey = params.get('mk') || currentMonthKey();
  const yearKey = params.get('yk') || currentYearKey();
  const customSince = params.get('cs') || '';
  const customUntil = params.get('cu') || '';

  const win = useMemo(
    () => resolveWindow({ mode, monthKey, yearKey, customSince, customUntil }),
    [mode, monthKey, yearKey, customSince, customUntil],
  );

  const patch = useCallback(
    (next: Record<string, string>) => {
      const sp = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(next)) sp.set(k, v);
      router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );

  const value = useMemo<ScopePeriodState>(
    () => ({
      scope, mode, monthKey, yearKey, customSince, customUntil, win,
      setScope: (s) => patch({ scope: s }),
      setMode: (m) => patch({ mode: m }),
      setMonthKey: (k) => patch({ mode: 'month', mk: k }),
      setYearKey: (k) => patch({ mode: 'year', yk: k }),
      setCustom: (cs, cu) => patch({ mode: 'custom', cs, cu }),
      // Legacy derived fields (month-only; no day pill any more).
      period: 'month',
      periodKey: mode === 'month' ? monthKey : currentMonthKey(),
    }),
    [scope, mode, monthKey, yearKey, customSince, customUntil, win, patch],
  );

  return <ScopePeriodContext.Provider value={value}>{children}</ScopePeriodContext.Provider>;
}

/** Read the scope/period state. Throws if used outside the provider. */
export function useScopePeriod(): ScopePeriodState {
  const ctx = useContext(ScopePeriodContext);
  if (!ctx) throw new Error('useScopePeriod must be used within ScopePeriodProvider');
  return ctx;
}

/** Build the shared `scope` + `since/until/label` query params every analytics hook sends. */
export function windowParams(scope: Scope, win: ResolvedWindow): string {
  const sp = new URLSearchParams({ scope, since: win.since, until: win.until });
  if (win.label) sp.set('label', win.label);
  return sp.toString();
}

/** Stable React Query key fragment so analytics hooks refetch on scope/window change. */
export function scopeKey({ scope, win }: Pick<ScopePeriodState, 'scope' | 'win'>) {
  return { scope, since: win.since, until: win.until };
}
