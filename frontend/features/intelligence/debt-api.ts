import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export type DebtBand = { key: string; label: string; count: number; total_pence: number };
export type DebtorRow = {
  name: string;
  practice: string | null;
  treatment: string | null;
  amount_pence: number;
  age_days: number;
};
export type DebtView = {
  outstanding_pence: number;
  overdue90_pence: number;
  recovered_ttm_pence: number;
  collection_rate_pct: number | null;
  bands: DebtBand[];
  debtors: DebtorRow[];
};

export function useDebt(practiceId?: string) {
  return useQuery({
    queryKey: ['debt', practiceId ?? 'all'],
    queryFn: () => api<DebtView>(`/api/debt${practiceId ? `?practice_id=${practiceId}` : ''}`),
    staleTime: 60_000,
  });
}

// Compact £ from pence: >=1M -> "£1.2M", >=1k -> "£124k", else "£840".
export function formatPenceCompact(pence: number): string {
  const n = (pence || 0) / 100;
  if (Math.abs(n) >= 1_000_000) return '£' + (n / 1_000_000).toFixed(1) + 'M';
  if (Math.abs(n) >= 1_000) return '£' + Math.round(n / 1_000) + 'k';
  return '£' + Math.round(n);
}
