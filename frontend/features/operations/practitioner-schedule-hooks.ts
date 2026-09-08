import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getScheduleOverview, saveScheduleWeek, saveScheduleOverride,
  type ScheduleDay, type OverridePatch,
} from './practitioner-schedule-api';

export function useScheduleOverview() {
  return useQuery({
    queryKey: ['practitioner-schedules'],
    queryFn: getScheduleOverview,
    staleTime: 60_000,
  });
}

export function useSaveScheduleWeek() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { practitionerId: string; days: ScheduleDay[] }) =>
      saveScheduleWeek(v.practitionerId, v.days),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['practitioner-schedules'] });
      // A schedule change moves the denominator of every utilisation figure in
      // the product, so the reports must not keep serving the old one.
      qc.invalidateQueries({ queryKey: ['practitioner-utilisation'] });
    },
  });
}

export function useSaveScheduleOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { practitionerId: string; day: string; override: OverridePatch | null }) =>
      saveScheduleOverride(v.practitionerId, v.day, v.override),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['practitioner-schedules'] });
      qc.invalidateQueries({ queryKey: ['practitioner-utilisation'] });
    },
  });
}
