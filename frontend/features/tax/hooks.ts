import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchTaxOverview, fetchTaxSettings, fetchTaxTreatments,
  saveTaxSettings, setTreatmentLiability,
  type TaxSettings, type Liability,
} from './api';

const OVERVIEW = ['tax', 'overview'];
const SETTINGS = ['tax', 'settings'];
const TREATMENTS = ['tax', 'treatments'];

export const useTaxOverview = () => useQuery({ queryKey: OVERVIEW, queryFn: fetchTaxOverview });
export const useTaxSettings = () => useQuery({ queryKey: SETTINGS, queryFn: fetchTaxSettings });
export const useTaxTreatments = () => useQuery({ queryKey: TREATMENTS, queryFn: fetchTaxTreatments });

// Both mutations invalidate the OVERVIEW as well as their own query: changing
// the entity type or a single treatment's liability moves the figures on the
// cards, and leaving those cached would show a tax position that no longer
// matches the settings that produced it.
export function useSaveTaxSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<TaxSettings>) => saveTaxSettings(body),
    onSuccess: (data) => {
      qc.setQueryData(SETTINGS, data);
      qc.invalidateQueries({ queryKey: OVERVIEW });
    },
  });
}

export function useSetTreatmentLiability() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { description: string; liability: Liability | null }) => setTreatmentLiability(b),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TREATMENTS });
      qc.invalidateQueries({ queryKey: OVERVIEW });
    },
  });
}
