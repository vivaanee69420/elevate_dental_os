// React Query hooks for the Dentally-backed growth endpoints.
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  getPracticePerformance,
  getPracticePatients,
  getBookingSummary,
  getRecentBookings,
  type DateRange,
} from './api';

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
