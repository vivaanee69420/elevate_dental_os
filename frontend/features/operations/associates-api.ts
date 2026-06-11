import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export type AssociateRow = {
  id: string;
  full_name: string;
  practice: string | null;
  practices: string[];
  practice_count: number;
  pay_pct: number | null;
  joined_date: string | null;
  active: boolean;
  gdc_number: string | null;
  colour: string | null;
  role: string | null;
  uda_target: number | null;
  treatments: number;
  appointments_total: number;
  no_shows: number;
  completion_pct: number | null;
  no_show_pct: number | null;
  status: 'top' | 'good' | 'review';
  ttm_production: number | null;
  ttm_uda: number | null;
  conversion: number | null;
};

export function useAssociates(practiceId?: string) {
  return useQuery({
    queryKey: ['associates', practiceId ?? 'all'],
    queryFn: () =>
      api<{ associates: AssociateRow[] }>(
        `/api/associates${practiceId ? `?practice_id=${practiceId}` : ''}`,
      ),
    staleTime: 60_000,
  });
}
