// Growth API client — Dentally-sourced aggregates (per-practice performance,
// booking summary, recent bookings). Mirrors backend/src/routes/growth.routes.js.
// Reviews / loyalty / benchmark / marketing-source data are NOT served here:
// they aren't Dentally data and remain mock fixtures in ./data.

import { api } from '@/lib/api';

export interface DateRange {
  from: string | null;
  to: string | null;
}

// from/to only take effect when BOTH are set (backend overrides its rolling
// 30-day window only then); otherwise → default window. Matches finance.
function filterQS(practiceId?: string | null, range?: DateRange | null): string {
  const params = new URLSearchParams();
  if (practiceId) params.set('practice_id', practiceId);
  if (range?.from && range?.to) {
    params.set('from', range.from);
    params.set('to', range.to);
  }
  const q = params.toString();
  return q ? `?${q}` : '';
}

/** One practice's performance over the selected window (default last 30 days). */
export interface PracticePerformance {
  practice_id: string;
  name: string;
  new_patients_30d: number;
  appts_30d: number;
  completed_30d: number;
  no_show_30d: number;
  revenue_pence_30d: number;
}

export function getPracticePerformance(practiceId?: string | null, range?: DateRange | null) {
  return api<{ practices: PracticePerformance[] }>(
    `/api/growth/practice-performance${filterQS(practiceId, range)}`,
  );
}

/** Appointment-derived booking KPIs over the selected window. */
export interface BookingSummary {
  booked_30d: number;
  completed_30d: number;
  no_show_30d: number;
  today: number;
  this_week: number;
  this_month: number;
  no_show_rate: number;
}

export function getBookingSummary(practiceId?: string | null, range?: DateRange | null) {
  return api<BookingSummary>(`/api/growth/booking${filterQS(practiceId, range)}`);
}

/** A recent/upcoming appointment row. service + deposit may be null/0/false
 * (Dentally does not populate appointment_type / deposit_pence / deposit_paid).
 * patient is null when the appointment has no linked contact. */
export interface RecentBooking {
  id: string;
  starts_at: string;
  status: string;
  service: string | null;
  deposit_pence: number;
  deposit_paid: boolean;
  patient: string | null;
  practice: string | null;
}

export interface RecentBookingsResponse {
  bookings: RecentBooking[];
  total: number;
  page: number;
  per_page: number;
}

/** One patient row in a practice's roster. */
export interface PracticePatient {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  created_at: string;
}

export interface PracticePatientsResponse {
  patients: PracticePatient[];
  total: number;
  page: number;
  per_page: number;
}

export function getPracticePatients(
  practiceId: string,
  page = 1,
  perPage = 10,
  search = '',
) {
  const params = new URLSearchParams({ practice_id: practiceId, page: String(page), per_page: String(perPage) });
  if (search) params.set('search', search);
  return api<PracticePatientsResponse>(`/api/growth/practice-patients?${params.toString()}`);
}

export function getRecentBookings(
  practiceId?: string | null,
  range?: DateRange | null,
  page = 1,
  perPage = 10,
) {
  const base = filterQS(practiceId, range);
  const sep = base ? '&' : '?';
  return api<RecentBookingsResponse>(
    `/api/growth/recent-bookings${base}${sep}page=${page}&per_page=${perPage}`,
  );
}
