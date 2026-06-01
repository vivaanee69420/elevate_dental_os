import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export type PayDraftRow = {
  associate_id: string;
  full_name: string;
  practice: string | null;
  pay_pct: number; // basis points (4500 = 45%)
  lab_split_pct: number; // basis points
  production_pence: number;
  lab_cost_pence: number;
  gross_pence: number;
  lab_deduction_pence: number;
  prev_balance_pence: number;
  net_pence: number;
};

export type PayDraft = {
  period_start: string;
  period_end: string;
  status: string;
  rows: PayDraftRow[];
  totals: { production: number; gross: number; lab: number; net: number };
  pct_of_production: number;
};

// The last complete calendar month, as { start, end, label } — the default
// window for a draft pay run (today's month is still in progress).
export function lastCompleteMonth(now = new Date()) {
  const end = new Date(now.getFullYear(), now.getMonth(), 0); // day 0 = last day of prev month
  const start = new Date(end.getFullYear(), end.getMonth(), 1);
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const label = start.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  return { start: iso(start), end: iso(end), label };
}

export function useDraftPayRun(period: { start: string; end: string }) {
  return useQuery({
    queryKey: ['pay-draft', period.start, period.end],
    queryFn: () =>
      api<PayDraft>(`/api/pay-runs/draft?period_start=${period.start}&period_end=${period.end}`),
    staleTime: 60_000,
  });
}
