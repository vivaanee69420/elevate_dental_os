// Business Hub API — the group + per-practice business rollup.
// GET /api/analytics/business-hub (finance.view gated). All *_pence are integer pence.

import { api } from '@/lib/api';
import { useQuery } from '@tanstack/react-query';
import { useScopePeriod, type Period } from '@/features/_shared/scope-context';

export interface HubPractice {
  practiceId: string;
  name: string;
  chairs: number;
  revenuePence: number;
  appointments: number;
  completed: number;
  noShows: number;
  noShowRate: number;     // percentage points
  leads: number;
  conversionRate: number; // percentage points
}

export interface BusinessHub {
  period: { days: number; since: string; until: string | null; label: string | null };
  group: {
    practices: number;
    revenuePence: number;
    revenueTargetPence: number;
    marginPct: number;
    appointments: number;
    noShows: number;
    noShowRate: number;
    noShowTracked: boolean; // false => Dentally never synced a no_show state; render "—"
    leads: number;
    conversionRate: number;
    treatmentsStarted: number;     // plans started in window (Dentally)
    treatmentsClosedPence: number; // private value of completed plans in window
    leadToStartRate: number;       // treatmentsStarted / leads, percentage points
  };
  practices: HubPractice[];
  truncated: boolean;
}

// An explicit [since, until] window with a human label, or a trailing-days window.
export interface HubWindow {
  days?: number;
  since?: string;
  until?: string;
  label?: string;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Turn the global Scope/Period state into a concrete [since, until] window + label.
// month 'YYYY-MM' -> the whole calendar month; day 'YYYY-MM-DD' -> that single day.
// All bounds in UTC to match the server's stable UTC period keys.
export function windowFromPeriod(period: Period, periodKey: string): HubWindow {
  if (period === 'day') {
    const [y, m, d] = periodKey.split('-').map(Number);
    if (!y || !m || !d) return { days: 90 };
    const start = Date.UTC(y, m - 1, d);
    const end = Date.UTC(y, m - 1, d + 1) - 1;
    return {
      since: new Date(start).toISOString(),
      until: new Date(end).toISOString(),
      label: `${d} ${MONTHS[m - 1]} ${y}`,
    };
  }
  const [y, m] = periodKey.split('-').map(Number);
  if (!y || !m) return { days: 90 };
  const start = Date.UTC(y, m - 1, 1);
  const end = Date.UTC(y, m, 1) - 1; // last ms of the month
  return {
    since: new Date(start).toISOString(),
    until: new Date(end).toISOString(),
    label: `${MONTHS[m - 1]} ${y}`,
  };
}

function queryString(win: HubWindow): string {
  if (win.since && win.until) {
    const sp = new URLSearchParams({ since: win.since, until: win.until });
    if (win.label) sp.set('label', win.label);
    return sp.toString();
  }
  return `days=${win.days ?? 90}`;
}

export function getBusinessHub(win: HubWindow = { days: 90 }) {
  return api<BusinessHub>(`/api/analytics/business-hub?${queryString(win)}`);
}

// useBusinessHub() with no arg follows the global month/day filter. Pass a number
// (legacy) or an explicit HubWindow to pin a trailing-days or custom window
// regardless of the filter (used by screens that aren't period-scoped).
export function useBusinessHub(arg?: number | HubWindow) {
  const { period, periodKey } = useScopePeriod();
  const win: HubWindow =
    typeof arg === 'number' ? { days: arg }
    : arg ? arg
    : windowFromPeriod(period, periodKey);
  return useQuery({
    queryKey: ['business-hub', win],
    queryFn: () => getBusinessHub(win),
    staleTime: 30_000,
  });
}
