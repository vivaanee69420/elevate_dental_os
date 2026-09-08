import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getChairWeek, saveChairWeek, createChair, updateChair, deleteChair, saveOpeningHours,
  type OpeningHoursDay, type WeekCellInput,
} from './chair-entry-api';

export function useChairWeek(practiceId: string | undefined) {
  return useQuery({
    queryKey: ['chair-week', practiceId],
    queryFn: () => getChairWeek(practiceId!),
    enabled: !!practiceId,
  });
}

/** Every mutation invalidates the week AND the analytics, because changing a
 *  chair or an opening hour changes the capacity Chair Efficiency reports. */
function useInvalidate(practiceId: string | undefined) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['chair-week', practiceId] });
    qc.invalidateQueries({ queryKey: ['chair-analytics'] });
    qc.invalidateQueries({ queryKey: ['chair-grid', practiceId] });
  };
}

export function useSaveChairWeek(practiceId: string | undefined) {
  const invalidate = useInvalidate(practiceId);
  return useMutation({
    mutationFn: (input: { practice_id: string; chair_id: string; cells: WeekCellInput[] }) =>
      saveChairWeek(input),
    onSuccess: invalidate,
  });
}

export function useCreateChair(practiceId: string | undefined) {
  const invalidate = useInvalidate(practiceId);
  return useMutation({
    mutationFn: (input: { practice_id: string; name: string; display_order?: number }) =>
      createChair(input),
    onSuccess: invalidate,
  });
}

export function useUpdateChair(practiceId: string | undefined) {
  const invalidate = useInvalidate(practiceId);
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { name?: string; active?: boolean } }) =>
      updateChair(id, patch),
    onSuccess: invalidate,
  });
}

export function useDeleteChair(practiceId: string | undefined) {
  const invalidate = useInvalidate(practiceId);
  return useMutation({ mutationFn: (id: string) => deleteChair(id), onSuccess: invalidate });
}

export function useSaveOpeningHours(practiceId: string | undefined) {
  const invalidate = useInvalidate(practiceId);
  return useMutation({
    mutationFn: (input: { practice_id: string; days: OpeningHoursDay[] }) => saveOpeningHours(input),
    onSuccess: invalidate,
  });
}
