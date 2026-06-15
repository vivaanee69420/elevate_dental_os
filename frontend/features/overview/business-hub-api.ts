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
  takingsPence: number;          // settled payments received, this practice (matches Patient Payments "Received")
  treatmentsClosedPence: number; // plan fees billed (sold), this practice
  treatmentsPaidPence: number;   // plan fees paid (collected), this practice
  appointments: number;
  completed: number;
  noShows: number;
  noShowRate: number;     // percentage points
  leads: number;
  conversionRate: number; // percentage points
  newPatients: number;    // Dentally registrations (joined date) in window, this practice
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
    leadsBySource: { source: string; leads: number }[]; // Google Ads / Meta Ads / GHL — named sections
    conversionRate: number;
    newPatients: number;           // booked Dentally new-patient appointments (real PMS)
    treatmentsStarted: number;     // plans started in window (Dentally)
    treatmentsCompleted: number;   // completed plan count in window (practitioner activity)
    treatmentsCompletedValuePence: number; // value of completed plans (private treatment value)
    treatmentsAcceptedCount: number;       // accepted treatments (Emergent) — 0 until connected
    treatmentsAcceptedValuePence: number;  // value of accepted treatments (Emergent)
    treatmentsClosedPence: number; // plan fees BILLED in window (sold) — invoice_items
    treatmentsPaidPence: number;   // plan fees PAID in window (collected) — invoice_paid subset
    takingsPence: number;          // settled payments received in window (matches Patient Payments "Received")
    cashCollectedPence: number;    // settled receipts banked in window (== takings)
    turnoverDeltaPct: number | null; // turnover vs prior same-length period; null => no base
    cashDeltaPct: number | null;     // cash vs prior same-length period; null => no base
    prevPeriodLabel: string;         // label for the comparison period ("May 2026")
    prevRevenuePence: number;        // turnover in the prior period
    prevCashPence: number;           // settled receipts in the prior period
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
