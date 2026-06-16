import { api } from '@/lib/api';
import { windowParams, type ResolvedWindow } from '@/features/_shared/scope-context';

// Chair Efficiency (Intelligence OS) — GET /api/analytics/chair. All money is
// integer pence; hours are annual. OCPSPD + profit-per-chair-hour are deferred
// server-side (null) pending per-practice opex/treatment-minute sourcing.

export interface ChairPracticeRow {
  id: string;
  name: string;
  chairs: number;
  occupancyPct: number;
  utilAssumed: boolean;
  occupancySource: 'manual' | 'none';
  annualRevenuePence: number;
  capHrsYr: number;
  bookedHrsYr: number;
  emptyHrsYr: number;
  revPerBookedHrPence: number;
  revPotentialYrPence: number;
  lostPotentialYrPence: number;
  recoverableToBenchHrsYr: number;
  recoverRevYrPence: number;
  surgeryDaysYr: number;
  occVariancePct: number;
}

export interface ChairGroup {
  chairs: number;
  capHrsYr: number;
  bookedHrsYr: number;
  emptyHrsYr: number;
  occupancyPct: number;
  lostPotentialYrPence: number;
  recoverRevYrPence: number;
  revPotentialYrPence: number;
  blendedRevPerBookedHrPence: number;
}

export interface ChairAnalytics {
  applicable: boolean;
  scope: string;
  message?: string;
  config?: { openHrs: number; weeksYr: number; daysWk: number; benchOccPct: number; benchRevHrPence: number };
  practices?: ChairPracticeRow[];
  group?: ChairGroup;
  recovery?: { recoveryHrsYr: number; revenueUnlockedPence: number; newOccupancyPct: number };
  ocpspd: null;
  profitPerChairHour: null;
  note?: string;
}

export function fetchChairAnalytics(scope: string, recover: number, win: ResolvedWindow): Promise<ChairAnalytics> {
  return api<ChairAnalytics>(`/api/analytics/chair?${windowParams(scope, win)}&recover=${recover}`);
}
