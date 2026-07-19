import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchAdAttributionConfig,
  setPipelineChannel,
  setSubaccountPractice,
  setAdAccountPractice,
  type AdChannel,
  type AdAttributionConfig,
} from './api';

const CONFIG_KEY = ['ad-attribution-config'] as const;

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

// Optimistic: the button flips the moment it is clicked, then the refetch
// confirms it. Sorting 113 pipelines means a lot of clicks in a row, and
// waiting for a server round trip after each one made a saved change look like
// a dead button — the write had succeeded, the refreshed state just had not
// arrived yet. onError rolls the row back to the exact snapshot taken before
// the click, so a failure never leaves a lie on screen.
export function useSetPipelineChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ accountId, pipelineId, channel }: { accountId: string; pipelineId: string; channel: AdChannel | null }) =>
      setPipelineChannel(accountId, pipelineId, channel),
    onMutate: async ({ accountId, pipelineId, channel }) => {
      // Stop an in-flight refetch from landing on top of the optimistic write.
      await qc.cancelQueries({ queryKey: CONFIG_KEY });
      const previous = qc.getQueryData<AdAttributionConfig>(CONFIG_KEY);
      if (previous) {
        qc.setQueryData<AdAttributionConfig>(CONFIG_KEY, {
          ...previous,
          pipelines: previous.pipelines.map((p) =>
            p.accountId === accountId && p.pipelineId === pipelineId ? { ...p, channel } : p,
          ),
        });
      }
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(CONFIG_KEY, ctx.previous);
    },
    onSettled: () => invalidateAdAttribution(qc),
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
