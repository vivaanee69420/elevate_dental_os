// Practitioner utilisation — typed client for GET /api/chair-utilisation/practitioners.
//
// Every figure is server-aggregated. Nothing here recomputes a total from the
// rows it was handed: the day series, the per-practitioner rows and the
// headline all come from one SQL pass over the same window, so they cannot
// disagree with each other.

import { api } from '@/lib/api';

export interface UtilDay {
  day: string;                   // YYYY-MM-DD, London
  availableHours: number;
  utilisedHours: number;
  unusedHours: number;
  /** null when there were no available hours — never 0%. */
  utilisationPct: number | null;
  practitioners: number;
  /** null when nothing was invoiced that day. */
  revenuePence: number | null;
}

export interface UtilPractitionerDay {
  day: string;
  /** The site this day was worked at — a practitioner can move between them. */
  practiceId: string | null;
  utilisationPct: number | null;
  availableHours: number;
  utilisedHours: number;
  patientAppts: number;
  revenuePence: number | null;
}

export interface UtilPractitioner {
  practitionerId: string;
  practitionerName: string;
  /** The site worked most days in this window; the per-day one is exact. */
  practiceId: string | null;
  daysWorked: number;
  availableHours: number;
  utilisedHours: number;
  utilisationPct: number | null;
  patientAppts: number;
  revenuePence: number | null;
  revenuePerUtilisedHourPence: number | null;
  days: UtilPractitionerDay[];
}

/** Which derived denominator the figures were divided by. */
export type UtilBasis = 'span' | 'clinical';

export interface PractitionerUtilisation {
  window: { since: string; until: string };
  basis: UtilBasis;
  totals: {
    utilisationPct: number | null;
    availableHours: number;
    utilisedHours: number;
    unusedHours: number;
    practitioners: number;
    daysWorked: number;
    patientAppts: number;
    revenuePence: number | null;
    revenuePerUtilisedHourPence: number | null;
    revenuePerAvailableHourPence: number | null;
    unusedHoursValuePence: number | null;
  };
  /** Diary days set aside as "not working" — stated, never hidden. */
  excluded: {
    blockOnlyDays: number;
    blockOnlyHours: number;
    practitioners: number;
  };
  days: UtilDay[];
  practitioners: UtilPractitioner[];
}

export function getPractitionerUtilisation(opts: {
  since: string;
  until: string;
  practiceId?: string | null;
  basis?: UtilBasis;
}): Promise<PractitionerUtilisation> {
  const params = new URLSearchParams({ since: opts.since, until: opts.until });
  if (opts.practiceId) params.set('practice_id', opts.practiceId);
  if (opts.basis) params.set('basis', opts.basis);
  // The "?" is added here and never baked into the query string — a helper
  // that returned one without it produced a silently-404ing URL elsewhere in
  // this codebase.
  return api<PractitionerUtilisation>(`/api/chair-utilisation/practitioners?${params.toString()}`);
}
