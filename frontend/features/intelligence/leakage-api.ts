import { api } from '@/lib/api';
import { windowParams, type ResolvedWindow } from '@/features/_shared/scope-context';

// Revenue Leakage (GM Intelligence OS) — GET /api/analytics/leakage.
// "Money left on the table" over the window, annualised. Five recoverable
// pools (lost plans / FTA / unbooked recalls / lapsed patients / uncollected),
// each scaled by a tunable recoverable rate. Money is integer PENCE.
//
// Driven by REAL rollups: settled turnover, appointment no-shows, treatment-
// plan value (presented vs accepted) and banked receipts. recall + lapsed use
// modelled shares of revenue until patient-level Dentally cohorts are wired.

export interface LeakageLine {
  /** 'measured' = observed in your data · 'modelled' = a planning assumption. */
  basis: 'measured' | 'modelled';
  key: 'plans' | 'fta' | 'recall' | 'lapsed' | 'collect';
  label: string;
  sub: string;
  owner: string;
  windowPence: number;
  annualPence: number;
  monthlyPence: number;
}

export interface LeakageRates {
  plans: number;
  fta: number;
  recall: number;
  lapsed: number;
  collect: number;
}

export interface Leakage {
  windowDays: number;
  since: string;
  until: string | null;
  rates: LeakageRates;
  ftaRatePct: number;
  windowTotalPence: number;
  annualTotalPence: number;
  /**
   * Pools built from real observations (a measured no-show rate, a real unpaid
   * invoice balance). This is the honest headline — the page used to lead with
   * the sum of everything, 93% of which was a modelled plans figure.
   */
  measuredAnnualPence: number;
  /** Flat shares of revenue and the open-plans upper bound. Planning figures. */
  modelledAnnualPence: number;
  /**
   * Completed share of presented plan value. Near zero across mature months
   * means the completion flag is not populated, so the plans pool cannot be
   * read as lost work.
   */
  planCompletionPct: number | null;
  monthlyTotalPence: number;
  asPctOfRevenue: number;
  inputs: {
    revenuePence: number;
    appointments: number;
    noShows: number;
    cashCollectedPence: number;
    /** Real unpaid invoice balance — what the collections pool is taken from. */
    outstandingPence: number;
    windowDays: number;
    /** The MODELLED constants, so a proof panel can show the assumption. */
    hygieneSharePct: number;
    lapsedSharePct: number;
    presentedPence: number;
    acceptedPence: number;
  };
  lines: LeakageLine[];
}

export function fetchLeakage(
  scope: string,
  win: ResolvedWindow,
  rates?: Partial<LeakageRates>,
): Promise<Leakage> {
  let qs = windowParams(scope, win);
  if (rates) {
    for (const [k, v] of Object.entries(rates)) {
      if (Number.isFinite(v)) qs += `&rate_${k}=${v}`;
    }
  }
  return api<Leakage>(`/api/analytics/leakage?${qs}`);
}
