// Business Hub API — the group + per-practice business rollup.
// GET /api/analytics/business-hub (finance.view gated). All *_pence are integer pence.

import { api } from '@/lib/api';
import { useQuery } from '@tanstack/react-query';
import { useScopePeriod } from '@/features/_shared/scope-context';

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

export interface RevenueLine {
  line: string;        // clinical category (Implants, Restorative, …)
  fee_pence: number;   // invoiced revenue in window
  item_count: number;
  cost_pence: number;  // 0 until a P&L feed (Xero/QuickBooks) is connected
  profit_pence: number; // = fee_pence while cost is 0
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
    newPatients: number;           // leads reaching treatment (real Dentally/GHL)
    treatmentsStarted: number;     // plans started in window (Dentally)
    treatmentsCompleted: number;   // accepted/completed plan count in window
    treatmentsClosedPence: number; // private value of completed plans in window
    cashCollectedPence: number;    // settled receipts banked in window
    collectionRatePct: number | null; // trailing-12mo cash / billed; null => no billing feed
    trailing12BilledPence: number; // invoiced production over trailing 12mo
    trailing12CashPence: number;   // settled receipts over trailing 12mo
    leadToStartRate: number;       // treatmentsStarted / leads, percentage points
  };
  practices: HubPractice[];
  revenueByLine: RevenueLine[];
  revenueLineCostBasis: 'pl_margin' | null; // null => Xero/QuickBooks not connected, profit is gross (cost 0)
  revenueLineMarginPct: number;             // group net margin used to allocate per-line cost
  truncated: boolean;
}

// An explicit [since, until] window with a human label, or a trailing-days window.
export interface HubWindow {
  days?: number;
  since?: string;
  until?: string;
  label?: string;
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
  const { win: gw } = useScopePeriod();
  const win: HubWindow =
    typeof arg === 'number' ? { days: arg }
    : arg ? arg
    : { since: gw.since, until: gw.until, label: gw.label };
  return useQuery({
    queryKey: ['business-hub', win],
    queryFn: () => getBusinessHub(win),
    staleTime: 30_000,
  });
}
