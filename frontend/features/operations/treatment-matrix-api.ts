import { api } from '@/lib/api';
import { windowParams, type ResolvedWindow } from '@/features/_shared/scope-context';

// Treatment Mix heat matrix (GM Intelligence OS) — GET /api/analytics/treatment-matrix.
// Appointment VOLUME by treatment type x practice for the selected scope +
// period. VOLUME ONLY: Dentally appointments carry no price (data wall), so
// there is no revenue/margin here — this ranks clinical activity. Scope/period
// come from the global ScopePeriod control.

export interface MatrixPractice {
  id: string;
  name: string;
  total: number;
}

export interface MatrixTypeRow {
  type: string;
  total: number;
  sharePct: number;
  isOther: boolean;
  /** Cell volumes aligned to the `practices` column order. */
  cells: number[];
}

export interface MatrixInsight {
  tone: 'good' | 'warn' | 'bad' | 'info';
  title: string;
  body: string;
}

export interface TreatmentMatrix {
  applicable: boolean;
  scope: string;
  message?: string;
  period?: 'month' | 'day';
  window?: { since: string; until: string; label: string };
  practices: MatrixPractice[];
  types: MatrixTypeRow[];
  distinctTypes: number;
  /** Volume mode: appointment count. Revenue mode: total fee in PENCE. */
  grandTotal: number;
  /** Biggest single (non-Other) cell — drives heat intensity. Pence in revenue mode. */
  maxCell: number;
  insights: MatrixInsight[];
  note?: string;
  /** Revenue mode only. */
  basis?: string;
  hasData?: boolean;
}

const EMPTY: Omit<TreatmentMatrix, 'applicable' | 'scope'> = {
  practices: [], types: [], distinctTypes: 0, grandTotal: 0, maxCell: 0, insights: [],
};

// Volume matrix — appointment count by treatment type x practice.
export function fetchTreatmentMatrix(scope: string, win: ResolvedWindow): Promise<TreatmentMatrix> {
  return api<TreatmentMatrix>(`/api/analytics/treatment-matrix?${windowParams(scope, win)}`).then((r) => ({
    ...EMPTY, ...r, applicable: r.applicable !== false,
  }));
}

// Revenue matrix — real invoiced fee (PENCE) by treatment name x practice.
export function fetchTreatmentRevenue(scope: string, win: ResolvedWindow): Promise<TreatmentMatrix> {
  return api<TreatmentMatrix>(`/api/analytics/treatment-revenue?${windowParams(scope, win)}`).then((r) => ({
    ...EMPTY, ...r, applicable: r.applicable !== false,
  }));
}
