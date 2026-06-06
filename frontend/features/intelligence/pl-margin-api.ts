import { api } from '@/lib/api';
import { windowParams, type ResolvedWindow } from '@/features/_shared/scope-context';

// P&L & Margin (GM Intelligence OS) — GET /api/analytics/pl-margin.
// Scope/period-aware group P&L statement + per-entity breakdown from REAL
// monthly_financials actuals (Xero/QuickBooks override manual). Money in PENCE.
// Honest CoA granularity: staff includes associate/clinician pay (Xero books
// them together → dentistStaffSeparable:false); `tax` is below the line, excluded.

export interface PLLine {
  revPence: number;
  labMaterialsPence: number;
  grossPence: number;
  staffPence: number;
  otherOpexPence: number;
  netPence: number;
  marginPct: number;
}

export interface PLEntity extends PLLine {
  id: string;
  name: string;
  kind: 'practice' | 'academy' | 'lab';
  region: string;
  basis: 'month' | 'annual';
  periodsCovered: number;
}

export interface PLMargin {
  applicable: boolean;
  scope: string;
  period: 'month' | 'day';
  monthKey: string;
  basis: 'none' | 'actuals-month' | 'actuals-annual' | 'actuals-mixed';
  hasData: boolean;
  costsAvailable: boolean;
  periodsCovered: number;
  statement: PLLine;
  dentistStaffSeparable: boolean;
  perEntityAvailable: boolean;
  entityBasisMixed: boolean;
  entities: PLEntity[];
  note?: string;
}

const EMPTY: PLMargin = {
  applicable: true, scope: 'all', period: 'month', monthKey: '', basis: 'none',
  hasData: false, costsAvailable: false, periodsCovered: 0,
  statement: { revPence: 0, labMaterialsPence: 0, grossPence: 0, staffPence: 0, otherOpexPence: 0, netPence: 0, marginPct: 0 },
  dentistStaffSeparable: false, perEntityAvailable: false, entityBasisMixed: false, entities: [],
};

export function fetchPLMargin(scope: string, win: ResolvedWindow): Promise<PLMargin> {
  return api<PLMargin>(`/api/analytics/pl-margin?${windowParams(scope, win)}`).then((r) => ({ ...EMPTY, ...r }));
}
