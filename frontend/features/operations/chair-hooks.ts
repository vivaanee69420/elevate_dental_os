import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listChairRecords, getChairGrid, createChairRecord, updateChairRecord, deleteChairRecord,
  type ChairInput,
} from './chair-api';

export function useChairRecords(practiceId: string | undefined) {
  return useQuery({
    queryKey: ['chair-records', practiceId],
    queryFn: () => listChairRecords(practiceId!),
    enabled: !!practiceId,
  });
}

export function useChairGrid(practiceId: string | undefined) {
  return useQuery({
    queryKey: ['chair-grid', practiceId],
    queryFn: () => getChairGrid(practiceId!),
    enabled: !!practiceId,
  });
}

function useInvalidate(practiceId: string | undefined) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['chair-records', practiceId] });
    qc.invalidateQueries({ queryKey: ['chair-grid', practiceId] });
  };
}

export function useCreateChairRecord(practiceId: string | undefined) {
  const invalidate = useInvalidate(practiceId);
  return useMutation({ mutationFn: (input: ChairInput) => createChairRecord(input), onSuccess: invalidate });
}
export function useUpdateChairRecord(practiceId: string | undefined) {
  const invalidate = useInvalidate(practiceId);
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Omit<ChairInput, 'practice_id'>> }) =>
      updateChairRecord(id, patch),
    onSuccess: invalidate,
  });
}
export function useDeleteChairRecord(practiceId: string | undefined) {
  const invalidate = useInvalidate(practiceId);
  return useMutation({ mutationFn: (id: string) => deleteChairRecord(id), onSuccess: invalidate });
}
