// Reviews + Loyalty API clients. Kept separate from ./api.ts (Dentally-sourced
// growth aggregates / marketing) so concurrent marketing work there is not
// disturbed. Mirrors backend/src/routes/reviews.routes.js (GET /api/reviews)
// and backend/src/routes/growth.routes.js (GET /api/growth/loyalty).

import { api } from '@/lib/api';

// ---- Reviews ---------------------------------------------------------------
// GET /api/reviews -> { reviews: Review[] }. Rows are raw `reviews` table rows
// (select('*')), newest first (published_at desc), capped at 100. rating is a
// 1-5 integer; body / author_name / published_at / responded_at may be null.

export interface Review {
  id: string;
  organisation_id: string;
  practice_id: string | null;
  source: 'google' | 'trustpilot' | 'facebook' | 'treatwell' | 'direct';
  external_id: string | null;
  author_name: string | null;
  rating: number; // 1-5
  body: string | null;
  published_at: string | null;
  responded_at: string | null;
  response_body: string | null;
  flagged_for_recovery: boolean;
  created_at: string;
}

export interface ReviewsResponse {
  reviews: Review[];
}

export function getReviews() {
  return api<ReviewsResponse>('/api/reviews');
}

// ---- Loyalty ---------------------------------------------------------------
// GET /api/growth/loyalty -> { active, total } membership counts for the org.
// The endpoint carries no per-plan / MRR breakdown, so only the headline
// counts are live; the tier + reward cards remain static UI fixtures.

export interface LoyaltySummary {
  active: number;
  total: number;
}

export function getLoyaltySummary() {
  return api<LoyaltySummary>('/api/growth/loyalty');
}
