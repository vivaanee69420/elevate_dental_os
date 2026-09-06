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
  invoicedPence: number;            // Dentally Invoice Timeline "Total", this practice
  invoiceOutstandingPence: number;  // ... "Unpaid"
  invoiceSettledPence: number;      // ... "Paid" (settled by any means, not proof of cash)
  invoiceCount: number;
  treatmentsClosedPence: number; // plan fees billed (sold), this practice
  treatmentsPaidPence: number;   // plan fees paid (collected), this practice
  treatmentsCompleted: number;   // Practitioner Activity completed-treatment count, this practice
  treatmentsCompletedValuePence: number; // value of those completed treatments, this practice
  appointments: number;
  completed: number;
  noShows: number;
  /** Percentage points, or null when UNKNOWABLE — no appointments in the window,
   *  or the org's PMS has never synced a no-show state at all. Render "—". */
  noShowRate: number | null;
  leads: number;          // CRM leads only; ad-platform leads are group-level
  /** New patients per lead — the SAME definition as group.conversionRate.
   *  Null when this practice had no leads (a rate with no denominator). */
  conversionRate: number | null;
  crmConverted: number;               // CRM funnel: leads that reached treatment
  crmConversionRate: number | null;   // CRM funnel rate; null when no leads
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
    revenueTargetPence: number;        // the annual goal PRO-RATED to this window
    revenueTargetAnnualPence: number;  // the owner's stated annual goal, unscaled
    marginPct: number;
    marginBasis: 'trailing_12m';       // margin covers the last 12 ledger months, NOT the window
    appointments: number;
    noShows: number;
    /** Null when unknowable — no appointments, or no-show state never synced. */
    noShowRate: number | null;
    noShowTracked: boolean; // false => Dentally never synced a no_show state; render "—"
    leads: number;          // ALL sources: Google Ads + Meta Ads + CRM
    leadsCrm: number;       // CRM only — what the per-practice rows sum to
    // CRM enquiries split by the channel that bought them (structural match to
    // this org's own ad campaigns, the same test the Facebook report uses), plus
    // a derived remainder so the parts always sum to `leads`.
    leadsBySource: { source: string; leads: number }[];
    // Platform-REPORTED conversions (any optimised action, not enquiries). Kept
    // separate from leads on purpose — for the live org this reads ~4.6x the CRM
    // intake. Never present this as a lead count.
    adPlatformConversions: number;
    /** New patients per lead. Null when there were no leads at all. */
    conversionRate: number | null;
    newPatients: number;           // booked Dentally new-patient appointments (real PMS)
    treatmentsStarted: number;     // plans started in window (Dentally)
    treatmentsCompleted: number;   // completed-treatment count (Practitioner Activity feed) — group total
    treatmentsCompletedValuePence: number; // value of those completed treatments — group total
    treatmentsAcceptedCount: number;       // accepted treatments (Emergent) — 0 until connected
    treatmentsAcceptedValuePence: number;  // value of accepted treatments (Emergent)
    treatmentsAcceptedByPractice: { practiceId: string | null; name: string; count: number; valuePence: number }[]; // per-practice split for click-to-breakdown

    treatmentsClosedPence: number; // plan fees BILLED in window (sold) — invoice_items
    treatmentsPaidPence: number;   // plan fees PAID in window (collected) — invoice_paid subset
    takingsPence: number;          // settled payments received in window (matches Patient Payments "Received")
    // Dentally Invoice Timeline (Invoices -> Invoice Timeline, filter Location):
    // Total / Unpaid / Paid. `invoiceSettledPence` is the balance cleared by ANY
    // means — a payment OR an adjustment (write-off, plan allocation, insurance)
    // — so it is "settled", not proof that cash was received.
    invoicedPence: number;
    invoiceOutstandingPence: number;
    invoiceSettledPence: number;
    invoiceCount: number;
    // How far the invoice figures actually reach. Invoices arrive only in the
    // nightly PMS pull (webhooks carry contacts/appointments/payments, never
    // invoices), so a window running past the last sync is not yet complete and
    // the cards must say which days they cover. `throughYmd` null = never synced,
    // and `complete` is then true so no coverage claim is made at all.
    invoiceCoverage: { throughYmd: string | null; label: string | null; complete: boolean };
    cashCollectedPence: number;    // settled receipts banked in window (== takings)
    turnoverDeltaPct: number | null; // turnover vs prior period; null => no base
    cashDeltaPct: number | null;     // cash vs prior period; null => no base
    prevRevenuePence: number;        // turnover in the prior period
    prevCashPence: number;           // settled receipts in the prior period
    compare: HubCompare;             // the two windows every Dentally card is measured across
    leadToStartRate: number | null; // treatmentsStarted / leads; null when no leads
  };
  practices: HubPractice[];
  revenueByLine: RevenueLine[];
  revenueLineCostBasis: 'pl_margin' | null; // null => Xero/QuickBooks not connected, profit is gross (cost 0)
  revenueLineMarginPct: number;             // group net margin used to allocate per-line cost
  truncated: boolean;
}

// The period comparison behind every Dentally card. Both windows carry their own
// bounds and a label formatted FROM those bounds, so the dates a card names can
// never disagree with the rows behind them — the previous label used to be
// pattern-matched from the window and read "prev period" all through BST.
//
// `complete` is false while the selected period is still running. Both windows
// then cover the same elapsed span (1–6 Sep vs 1–6 Aug) rather than six days of
// data measured against a whole month, and the card VALUES are clamped to match.
export interface HubCompareWindow {
  since: string;
  until: string;
  label: string; // "Aug 2026" · "1–6 Sep 2026" · "31 Jul – 9 Aug 2026"
  days: number;  // London days covered, inclusive
}

export interface HubCompare {
  current: HubCompareWindow;
  previous: HubCompareWindow;
  complete: boolean;
  // One prior-period figure per Dentally card, each read from the same feed as
  // the current-window number it sits beside. `noShowRate` is null when the
  // previous window had no appointments — a rate with no denominator is
  // unknowable, not zero.
  prev: HubComparePrev & {
    turnoverPence: number;
    // Per-practice priors as well as the group totals. This endpoint is fetched
    // ONCE, group-wide, and the practice pills filter the payload in the
    // browser — so a card scoped to one site must read its own prior figure
    // here, not the group's.
    byPractice: (HubComparePrev & { practiceId: string })[];
  };
}

export interface HubComparePrev {
  takingsPence: number;
  invoicedPence: number;
  invoiceOutstandingPence: number;
  invoiceSettledPence: number;
  treatmentsCompleted: number;
  treatmentsAcceptedCount: number;
  treatmentsClosedPence: number;
  treatmentsPaidPence: number;
  appointments: number;
  noShowRate: number | null;
  newPatients: number;
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

// One invoice line behind the "Plan Fees Collected" card (drill-down). All
// *_pence are integer pence. collectedPence is each line's share of its
// invoice's actual payments (rounded to the penny for display).
export interface PlanFeeLine {
  id: string;
  invoicedOn: string;             // YYYY-MM-DD
  practiceId: string | null;
  practiceName: string | null;
  patientName: string | null;
  treatmentName: string | null;
  treatmentPlanId: string | null;
  invoiceId: string | null;
  billedPence: number;
  collectedPence: number;
  invoiceAmountPence: number | null;      // parent invoice gross (the pro-rata denominator)
  invoiceOutstandingPence: number | null; // still owed on that invoice
}

export interface PlanFeesLines {
  window: { since: string; until: string | null; label: string | null };
  totals: { billedPence: number; collectedPence: number; lineCount: number }; // canonical — matches the tile
  lines: PlanFeeLine[];
  basis: string;
  note: string;
}

// Lazy drill-down: only fetched when the card is expanded (enabled). Honours the
// global period window + the selected practice so it reconciles to the tile.
export function usePlanFeesLines(
  { enabled, practiceId }: { enabled: boolean; practiceId?: string | null },
) {
  const { win } = useScopePeriod();
  // The global filter always resolves to a concrete [since, until) window.
  const params = new URLSearchParams({ since: win.since, until: win.until });
  if (win.label) params.set('label', win.label);
  if (practiceId) params.set('practice_id', practiceId);
  const qs = params.toString();
  return useQuery({
    queryKey: ['plan-fees-lines', qs],
    queryFn: () => api<PlanFeesLines>(`/api/analytics/plan-fees-lines?${qs}`),
    enabled,
    // Matches the server-side Business Hub payload TTL, so returning to a
    // screen within the window is served from cache instead of refetching.
    staleTime: 60_000,
  });
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
    // Matches the server-side Business Hub payload TTL, so returning to a
    // screen within the window is served from cache instead of refetching.
    staleTime: 60_000,
  });
}
