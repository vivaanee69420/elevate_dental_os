import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getReviews,
  respondToReview,
  listReviewSources,
  searchReviewSources,
  addReviewSource,
  removeReviewSource,
  setReviewSourcePractice,
  setReviewSourceSelection,
  triggerReviewsSync,
  getReviewsSyncProgress,
  type ReviewFilters,
  type ReviewProvider,
} from './reviewsApi';

export function useReviews(filters: ReviewFilters = {}) {
  return useQuery({
    queryKey: ['reviews', filters.source ?? null, filters.practiceId ?? null],
    queryFn: () => getReviews(filters),
    staleTime: 30_000,
  });
}

export function useReviewSources() {
  return useQuery({ queryKey: ['review-sources'], queryFn: listReviewSources, staleTime: 30_000 });
}

export function useRespondToReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, response }: { id: string; response: string }) => respondToReview(id, response),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reviews'] }),
  });
}

// Picker search runs on demand (mutation, not query) so it only fires on submit.
export function useSearchReviewSources() {
  return useMutation({
    mutationFn: ({ provider, q }: { provider: ReviewProvider; q: string }) =>
      searchReviewSources(provider, q),
  });
}

export function useAddReviewSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: addReviewSource,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['review-sources'] });
      qc.invalidateQueries({ queryKey: ['reviews'] });
    },
  });
}

export function useRemoveReviewSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => removeReviewSource(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['review-sources'] });
      qc.invalidateQueries({ queryKey: ['reviews'] });
    },
  });
}

export function useSetReviewSourcePractice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, practiceId }: { id: string; practiceId: string | null }) =>
      setReviewSourcePractice(id, practiceId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['review-sources'] });
      qc.invalidateQueries({ queryKey: ['reviews'] });
    },
  });
}

export function useSetReviewSourceSelection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (selectedIds: string[]) => setReviewSourceSelection(selectedIds),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['review-sources'] });
      qc.invalidateQueries({ queryKey: ['reviews'] });
    },
  });
}

export function useTriggerReviewsSync() {
  return useMutation({ mutationFn: triggerReviewsSync });
}

// Polls live sync progress ~1/s while enabled.
export function useReviewsSyncProgress(enabled = false) {
  return useQuery({
    queryKey: ['reviews-sync-progress'],
    queryFn: getReviewsSyncProgress,
    enabled,
    refetchInterval: enabled ? 1000 : false,
  });
}
