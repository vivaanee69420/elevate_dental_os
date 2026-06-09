// React Query hooks for the Dentally-backed growth endpoints.
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  getPracticePerformance,
  getPracticePatients,
  getBookingSummary,
  getRecentBookings,
  getAdSpend,
  getMarketingRoi,
  type DateRange,
} from './api';
import { getReviews, getLoyaltySummary } from './reviews-loyalty-api';

export function usePracticePerformance(practiceId: string | null = null, range?: DateRange | null) {
  return useQuery({
    queryKey: ['growth', 'practice-performance', practiceId, range?.from ?? null, range?.to ?? null],
    queryFn: () => getPracticePerformance(practiceId, range),
  });
}

export function usePracticePatients(
  practiceId: string | null,
  page = 1,
  perPage = 10,
) {
  return useQuery({
    queryKey: ['growth', 'practice-patients', practiceId, page, perPage],
    queryFn: () => getPracticePatients(practiceId as string, page, perPage),
    enabled: !!practiceId,
    placeholderData: keepPreviousData,
  });
}

export function useBookingSummary(practiceId: string | null = null, range?: DateRange | null) {
  return useQuery({
    queryKey: ['growth', 'booking', practiceId, range?.from ?? null, range?.to ?? null],
    queryFn: () => getBookingSummary(practiceId, range),
  });
}

export function useRecentBookings(
  practiceId: string | null = null,
  range?: DateRange | null,
  page = 1,
  perPage = 10,
) {
  return useQuery({
    queryKey: ['growth', 'recent-bookings', practiceId, range?.from ?? null, range?.to ?? null, page, perPage],
    queryFn: () => getRecentBookings(practiceId, range, page, perPage),
    placeholderData: keepPreviousData,
  });
}

/** Live ad spend (Google Ads / Meta Ads). Account-level — no practice filter. */
export function useAdSpend(range?: DateRange | null) {
  return useQuery({
    queryKey: ['growth', 'ad-spend', range?.from ?? null, range?.to ?? null],
    queryFn: () => getAdSpend(range),
    placeholderData: keepPreviousData,
  });
}

/** Marketing ROI cross-cut (spend x leads x revenue x new patients). */
export function useMarketingRoi(range?: DateRange | null) {
  return useQuery({
    queryKey: ['growth', 'marketing-roi', range?.from ?? null, range?.to ?? null],
    queryFn: () => getMarketingRoi(range),
    placeholderData: keepPreviousData,
  });
}

/** Aggregated reviews feed (GET /api/reviews) — newest first, capped at 100. */
export function useReviews() {
  return useQuery({
    queryKey: ['growth', 'reviews'],
    queryFn: () => getReviews(),
  });
}

/** Membership counts for the org (GET /api/growth/loyalty). */
export function useLoyaltySummary() {
  return useQuery({
    queryKey: ['growth', 'loyalty'],
    queryFn: () => getLoyaltySummary(),
  });
}
