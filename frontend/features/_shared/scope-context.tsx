'use client';

// ScopePeriod engine — the global Scope + Period state that drives every
// analytics view (see GM-INTELLIGENCE-OS-PLAN.md). State lives in React and
// is mirrored to URL search params (?scope, ?period, ?pk) so a view is
// shareable and survives navigation. React Query keys include {scope, period,
// periodKey} so data refetches when any of them change.
//
//   scope  : 'all' | 'practices' | <practiceId> | 'academy' | 'lab'
//   period : 'month' | 'day'
//   pk     : period key — 'YYYY-MM' (month) or 'YYYY-MM-DD' (day)
//
// Academy/Lab are first-class entities (backend practices.kind, task T1). Until
// that lands they appear as fixed scope options here; the bar still works.

import { createContext, useCallback, useContext, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

export type Period = 'month' | 'day';
export type Scope = string; // 'all' | 'practices' | 'academy' | 'lab' | practiceId

export interface ScopePeriodState {
  scope: Scope;
  period: Period;
  /** Period key: 'YYYY-MM' for month, 'YYYY-MM-DD' for day. */
  periodKey: string;
  setScope: (s: Scope) => void;
  setPeriod: (p: Period) => void;
  setPeriodKey: (k: string) => void;
}

const ScopePeriodContext = createContext<ScopePeriodState | null>(null);

/** Default period key = current month 'YYYY-MM' (UTC, stable on server+client). */
function defaultMonthKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function ScopePeriodProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const scope: Scope = params.get('scope') || 'all';
  const period: Period = params.get('period') === 'day' ? 'day' : 'month';
  const periodKey = params.get('pk') || defaultMonthKey();

  const value = useMemo<ScopePeriodState>(() => {
    // Write one or more keys to the URL without scrolling or a full navigation.
    const patch = (next: Record<string, string>) => {
      const sp = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(next)) sp.set(k, v);
      router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
    };
    return {
      scope,
      period,
      periodKey,
      setScope: (s) => patch({ scope: s }),
      setPeriod: (p) => patch({ period: p }),
      setPeriodKey: (k) => patch({ pk: k }),
    };
  }, [scope, period, periodKey, pathname, params, router]);

  return <ScopePeriodContext.Provider value={value}>{children}</ScopePeriodContext.Provider>;
}

/** Read the scope/period state. Throws if used outside the provider. */
export function useScopePeriod(): ScopePeriodState {
  const ctx = useContext(ScopePeriodContext);
  if (!ctx) throw new Error('useScopePeriod must be used within ScopePeriodProvider');
  return ctx;
}

/** Stable React Query key fragment so analytics hooks refetch on scope/period change. */
export function scopeKey({ scope, period, periodKey }: Pick<ScopePeriodState, 'scope' | 'period' | 'periodKey'>) {
  return { scope, period, periodKey };
}
