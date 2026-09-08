import { api } from '@/lib/api';
import { windowParams, type ResolvedWindow } from '@/features/_shared/scope-context';

// Chair Efficiency (Intelligence OS) — GET /api/analytics/chair. All money is
// integer pence; hours are annual. OCPSPD + profit-per-chair-hour are deferred
// server-side (null) pending per-practice opex/treatment-minute sourcing.

// Every nullable field below is null for a REASON, and the UI must render an
// em dash rather than a zero for each. formatPence accepts number | null and
// renders null as a confident "£0.00" with no TypeScript warning, so the guard
// has to be at the call site.
export interface ChairCoverage {
  /** Chair x weekday x slot combinations the practice is actually open for. */
  openCells: number;
  enteredCells: number;
  /** null when the practice has no opening hours, so there is nothing to cover. */
  coveragePct: number | null;
  /** Entries sitting in slots the practice is now shut for — usually a sign the
   *  opening hours changed under data already entered. */
  closedCellEntries: number;
  /** Cells recording more booked time than the practice is open for. */
  overbookedCells: number;
  hasOpeningHours: boolean;
}

export interface ChairPracticeRow extends ChairCoverage {
  id: string;
  name: string;
  chairs: number;
  /** null when nothing has been entered — not 0%, which would read as empty. */
  occupancyPct: number | null;
  utilAssumed: boolean;
  /** 'grid' = opening hours known. 'none' = no hours, so nothing is knowable. */
  occupancySource: 'grid' | 'none';
  annualRevenuePence: number;
  capHrsYr: number;
  bookedHrsYr: number;
  emptyHrsYr: number;
  revPerBookedHrPence: number | null;
  /** null below the coverage threshold: an annualised pound figure over a
   *  fraction of a week is an invention, and a zero would read as "nothing is
   *  being lost". */
  lostPotentialYrPence: number | null;
  recoverRevYrPence: number | null;
}

export interface ChairGroup extends ChairCoverage {
  chairs: number;
  capHrsYr: number;
  bookedHrsYr: number;
  emptyHrsYr: number;
  occupancyPct: number | null;
  lostPotentialYrPence: number | null;
  recoverRevYrPence: number | null;
  revPerBookedHrPence: number | null;
  blendedRevPerBookedHrPence: number | null;
}

export interface ChairAnalytics {
  applicable: boolean;
  scope: string;
  message?: string;
  config?: { openHrs: number; weeksYr: number; daysWk: number; benchOccPct: number; benchRevHrPence: number };
  practices?: ChairPracticeRow[];
  group?: ChairGroup;
  /** null when no practice has an occupancy to climb from. Zeros here would
   *  read as "there is nothing to win back". */
  recovery?: { recoveryHrsYr: number; revenueUnlockedPence: number; newOccupancyPct: number } | null;
  /** Coverage below which the money figures are withheld. */
  coverageThresholdPct?: number;
  ocpspd: null;
  profitPerChairHour: null;
  note?: string;
}

export function fetchChairAnalytics(scope: string, recover: number, win: ResolvedWindow): Promise<ChairAnalytics> {
  return api<ChairAnalytics>(`/api/analytics/chair?${windowParams(scope, win)}&recover=${recover}`);
}
