import { api } from '@/lib/api';
import { windowParams, type ResolvedWindow } from '@/features/_shared/scope-context';

// Day — Cash Collected (GM Intelligence OS) — GET /api/analytics/cash-by-day.
// REAL settled receipts banked by working day across the month in scope, plus a
// composite collection index (each day vs the average working day = 100). This
// is cash receipts by processed_at date, NOT billed production. Money in PENCE.

export interface CashDay {
  date: string;   // 'YYYY-MM-DD'
  label: string;  // 'Tue 5 May'
  dow: number;    // 0=Sun .. 6=Sat
  pence: number;
  index: number;  // vs avg working day (100), 1dp
}

export interface CashByDayInsight {
  tone: 'good' | 'warn' | 'bad' | 'info';
  title: string;
  body: string;
  value?: string;
}

export interface CashByDay {
  applicable: boolean;
  scope: string;
  period: 'month' | 'day';
  window?: { since: string; until: string; label: string };
  monthLabel: string;
  basis: string;
  hasData: boolean;
  totalPence: number;
  avgPerDayPence: number;
  workingDays: number;
  days: CashDay[];
  peak: CashDay | null;
  selected: CashDay | null;
  insights: CashByDayInsight[];
  note?: string;
}

const EMPTY: CashByDay = {
  applicable: true, scope: 'all', period: 'month', monthLabel: '', basis: 'settled_receipts',
  hasData: false, totalPence: 0, avgPerDayPence: 0, workingDays: 0,
  days: [], peak: null, selected: null, insights: [],
};

export function fetchCashByDay(scope: string, win: ResolvedWindow): Promise<CashByDay> {
  return api<CashByDay>(`/api/analytics/cash-by-day?${windowParams(scope, win)}`).then((r) => ({ ...EMPTY, ...r }));
}
