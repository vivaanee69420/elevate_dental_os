import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useScopePeriod } from '@/features/_shared/scope-context';

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
  window_weeks: number | null;
  since: string;
  until: string | null;
};

// Treatment Mix is appointment VOLUME by type (Dentally appointments carry no
// price, so there is no revenue/margin here — see the data-wall memory). It
// follows the global Scope+Period filter: the resolved [since, until) window is
// sent to the backend, so the chart re-counts when the month/year/custom filter
// changes.
export function useTreatmentMix(practiceId?: string) {
  const { win } = useScopePeriod();
  return useQuery({
    queryKey: ['treatment-mix', practiceId ?? 'all', win.since, win.until],
    queryFn: () => {
      const sp = new URLSearchParams({ since: win.since, until: win.until });
      if (practiceId) sp.set('practice_id', practiceId);
      return api<TreatmentMix>(`/api/treatments?${sp.toString()}`);
    },
    staleTime: 60_000,
  });
}
