import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export type TreatmentMixRow = {
  type: string;
  volume: number;
  share_pct: number;
};

export type TreatmentMix = {
  treatments: TreatmentMixRow[];
  total_volume: number;
  distinct_types: number;
  top_treatment: string | null;
  window_weeks: number;
};

// Treatment Mix is appointment VOLUME by type (Dentally appointments carry no
// price, so there is no revenue/margin here — see the data-wall memory).
export function useTreatmentMix(practiceId?: string) {
  return useQuery({
    queryKey: ['treatment-mix', practiceId ?? 'all'],
    queryFn: () =>
      api<TreatmentMix>(
        `/api/treatments${practiceId ? `?practice_id=${practiceId}` : ''}`,
      ),
    staleTime: 60_000,
  });
}
