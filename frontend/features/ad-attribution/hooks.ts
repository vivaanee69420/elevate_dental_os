import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchAdAttributionConfig,
  setPipelineChannel,
  setSubaccountPractice,
  setAdAccountPractice,
  type AdChannel,
} from './api';

export function useAdAttributionConfig() {
  return useQuery({
    queryKey: ['ad-attribution-config'],
    queryFn: fetchAdAttributionConfig,
    staleTime: 30_000,
  });
}

// Every mapping mutation invalidates BOTH the config and the performance query:
// changing a mapping changes what the /ad-performance page reports, and a stale
// page after a remap is exactly the kind of contradiction that erodes trust in
// the numbers.
function invalidateAdAttribution(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['ad-attribution-config'] });
  qc.invalidateQueries({ queryKey: ['ad-performance'] });
}

export function useSetPipelineChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ accountId, pipelineId, channel }: { accountId: string; pipelineId: string; channel: AdChannel | null }) =>
      setPipelineChannel(accountId, pipelineId, channel),
    onSuccess: () => invalidateAdAttribution(qc),
  });
}

export function useSetSubaccountPractice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, practiceId }: { id: string; practiceId: string | null }) =>
      setSubaccountPractice(id, practiceId),
    onSuccess: () => invalidateAdAttribution(qc),
  });
}

export function useSetAdAccountPractice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, practiceId }: { id: string; practiceId: string | null }) =>
      setAdAccountPractice(id, practiceId),
    onSuccess: () => invalidateAdAttribution(qc),
  });
}
