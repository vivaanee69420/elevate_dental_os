// Practitioner schedules — the rota Dentally holds but does not publish.
//
// Times are MINUTES FROM LOCAL MIDNIGHT end to end, matching the tables and
// practice_opening_hours. These are wall-clock working hours; carried as
// instants they would move an hour twice a year.

import { api } from '@/lib/api';

export interface ScheduleDay {
  weekday: number;      // ISO 1 = Monday .. 7 = Sunday
  startMin: number;
  endMin: number;
  breakMin: number;
}

export interface ObservedDay {
  weekday: number;
  /** How many days of history this is drawn from — two is weak, twenty is not. */
  days: number;
  /** Median clinical window in minutes, or null. A HINT, never a suggestion:
   *  measured scatter is ±96 min on start times and ±131 on ends. */
  medianClinicalMin: number | null;
}

export interface SchedulePractitioner {
  practitionerId: string;
  practitionerName: string;
  practiceId: string | null;
  week: ScheduleDay[];
  observed: ObservedDay[];
  scheduledMinPerWeek: number;
}

export interface ScheduleOverview {
  observedWindow: { since: string; until: string };
  practitioners: SchedulePractitioner[];
  progress: { practitioners: number; withSchedule: number };
}

export function getScheduleOverview(): Promise<ScheduleOverview> {
  return api<ScheduleOverview>('/api/chair-utilisation/schedules');
}

/** Replaces the practitioner's WHOLE week. An empty array clears it, which is
 *  a real intention and distinct from sending nothing. */
export function saveScheduleWeek(practitionerId: string, days: ScheduleDay[]) {
  return api<{ days: ScheduleDay[] }>('/api/chair-utilisation/schedules/week', {
    method: 'PUT',
    body: JSON.stringify({ practitioner_id: practitionerId, days }),
  });
}

export interface OverridePatch {
  notWorking: boolean;
  startMin?: number;
  endMin?: number;
  breakMin?: number;
  note?: string;
}

export function saveScheduleOverride(
  practitionerId: string,
  day: string,
  override: OverridePatch | null,
) {
  return api<{ override: unknown }>('/api/chair-utilisation/schedules/override', {
    method: 'PUT',
    body: JSON.stringify({ practitioner_id: practitionerId, day, override }),
  });
}
