import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export type StaffRow = {
  id: string;
  full_name: string;
  role: string | null;
  practice: string | null;
  email: string | null;
  phone: string | null;
  last_login_at: string | null;
  recently_active: boolean;
};

export type StaffRoster = {
  staff: StaffRow[];
  total_staff: number;
  distinct_roles: number;
  practices_covered: number;
  active_count: number;
};

// Team roster from Dentally /users. No HR data (rate/hours/attendance) — that
// is not in the PMS, so the screen shows identity/role/practice/last-login only.
export function useStaff(practiceId?: string) {
  return useQuery({
    queryKey: ['staff', practiceId ?? 'all'],
    queryFn: () =>
      api<StaffRoster>(`/api/staff${practiceId ? `?practice_id=${practiceId}` : ''}`),
    staleTime: 60_000,
  });
}
