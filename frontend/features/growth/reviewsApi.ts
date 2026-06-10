// Reviews API client — live Google (Places) + Facebook (Graph) reviews and the
// review-source ("account") management that backs the Reviews screen filter bar.
// Mirrors backend/src/routes/reviews.routes.js. Replaces the old mock fixtures.

import { api } from '@/lib/api';

export type ReviewProvider = 'google' | 'facebook';

export interface ReviewRow {
  id: string;
  source: string;            // 'google' | 'facebook'
  external_id: string | null;
  author_name: string | null;
  rating: number;
  body: string | null;
  published_at: string | null;
  responded_at: string | null;
  response_body: string | null;
  flagged_for_recovery: boolean;
  practice_id: string | null;
  practice_name: string | null;
}

export interface ReviewBreakdownRow {
  name: string;
  count: number;
  rating: number;
}

export interface ReviewSummary {
  total: number;
  avg_rating: number;
  awaiting: number;
  by_source: ReviewBreakdownRow[];
  by_practice: ReviewBreakdownRow[];
  connected: boolean;
}

export interface ReviewSource {
  id: string;
  provider: ReviewProvider;
  external_id: string;
  name: string | null;
  address: string | null;
  practice_id: string | null;
  practice_name: string | null;
  is_selected: boolean;
  rating: number | null;
  total_count: number | null;
  last_sync_at: string | null;
  last_error: string | null;
}

export interface ReviewsResponse {
  reviews: ReviewRow[];
  summary: ReviewSummary;
  sources: ReviewSource[];
}

export interface ReviewFilters {
  source?: ReviewProvider | null;
  practiceId?: string | null;
}

function filterQS({ source, practiceId }: ReviewFilters = {}): string {
  const p = new URLSearchParams();
  if (source) p.set('source', source);
  if (practiceId) p.set('practice_id', practiceId);
  const q = p.toString();
  return q ? `?${q}` : '';
}

export function getReviews(filters: ReviewFilters = {}) {
  return api<ReviewsResponse>(`/api/reviews${filterQS(filters)}`);
}

export function respondToReview(id: string, response: string) {
  return api(`/api/reviews/${id}/respond`, {
    method: 'POST',
    body: JSON.stringify({ response }),
  });
}

// ---- Source ("account") management ----------------------------------------

/** A picker candidate (Google place or Facebook page). */
export interface ReviewSearchResult {
  place_id: string;          // Google place_id | Facebook page id
  name: string | null;
  address: string | null;
  rating: number | null;
  total_count: number | null;
}

export function listReviewSources() {
  return api<{ sources: ReviewSource[] }>('/api/reviews/sources');
}

export function searchReviewSources(provider: ReviewProvider, q: string) {
  const p = new URLSearchParams({ provider, q });
  return api<{ results: ReviewSearchResult[] }>(`/api/reviews/sources/search?${p.toString()}`);
}

export function addReviewSource(body: {
  provider: ReviewProvider;
  external_id: string;
  name?: string | null;
  address?: string | null;
  practice_id?: string | null;
}) {
  return api<{ source: ReviewSource }>('/api/reviews/sources', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function removeReviewSource(id: string) {
  return api<{ ok: boolean }>(`/api/reviews/sources/${id}`, { method: 'DELETE' });
}

export function setReviewSourcePractice(id: string, practiceId: string | null) {
  return api(`/api/reviews/sources/${id}/practice`, {
    method: 'PATCH',
    body: JSON.stringify({ practice_id: practiceId }),
  });
}

export function setReviewSourceSelection(selectedIds: string[]) {
  return api<{ sources: ReviewSource[] }>('/api/reviews/sources/selection', {
    method: 'POST',
    body: JSON.stringify({ selected_ids: selectedIds }),
  });
}

// ---- Sync ------------------------------------------------------------------

export function triggerReviewsSync() {
  return api<{ started: boolean }>('/api/reviews/sync', { method: 'POST' });
}

export interface ReviewsSyncProgress {
  running: boolean;
  pct: number;
  phase: string;
  done?: boolean;
  error?: string | null;
  count?: number;
  at?: number;
}

export function getReviewsSyncProgress() {
  return api<ReviewsSyncProgress>('/api/reviews/sync-progress');
}
