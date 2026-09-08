// Practitioner performance — time, treatment and money for one clinician, in
// one row. Every rate is `number | null` and null means "no denominator", so
// the render site must guard it: formatPence accepts null and renders a
// confident "£0.00" with no type error.

import { api } from '@/lib/api';
import type { UtilBasis } from './practitioner-utilisation-api';

/** One day of a practitioner's window. `utilisationPct` is NULL on a day with
 *  no measurable window — a chart must BREAK the line there rather than draw a
 *  point at zero, which would claim they sat idle. */
export interface PerfDay {
  day: string;
  availableHours: number;
  utilisedHours: number;
  utilisationPct: number | null;
  patientAppts: number;
  revenuePence: number | null;
  rostered: boolean | null;
}

/** The group's day, summed from the practitioner days rather than recomputed. */
export interface PerfGroupDay {
  day: string;
  availableHours: number;
  utilisedHours: number;
  unusedHours: number;
  utilisationPct: number | null;
  patientAppts: number;
  revenuePence: number | null;
  practitioners: number;
}

export interface PerfPractitioner {
  practitionerId: string;
  practitionerName: string;
  practiceId: string | null;

  // Time
  daysWorked: number;
  daysRostered: number;
  availableHours: number;
  utilisedHours: number;
  unusedHours: number;
  breakHours: number;
  utilisationPct: number | null;

  // Activity
  patientAppts: number;
  apptsPerWorkedDay: number | null;

  // Treatment. Null throughout when the feed is unavailable on this database —
  // which is a different fact from a clinician who completed none.
  treatments: number | null;
  treatmentPatients: number | null;
  treatmentValuePence: number | null;
  treatmentsPerUtilisedHour: number | null;
  /** The treatment they completed most OFTEN in the window — what they spend
   *  their days doing, not their most valuable single item. Null when the feed
   *  named nothing, so the card shows a dash rather than a blank. */
  topTreatment: string | null;
  topTreatmentCount: number | null;

  // Money. `revenuePence` is INVOICED fees; treatmentValuePence is the list
  // price of the work completed. Different numbers on purpose.
  revenuePence: number | null;
  revenuePerUtilisedHourPence: number | null;
  revenuePerAvailableHourPence: number | null;
  revenuePerDayPence: number | null;

  days: PerfDay[];
}

export interface PractitionerPerformance {
  window: { since: string; until: string };
  basis: UtilBasis;
  /** False when this database has no completed-treatment feed, so the page can
   *  say the column is unavailable instead of showing zeros. */
  treatmentsAvailable: boolean;
  /** The practice's five most repeated treatments, most repeated first. Its
   *  OWN read: the group's top is not the most popular of each clinician's
   *  tops, and deriving it that way returns a confident wrong answer. */
  topTreatments: { treatmentName: string; treatments: number; patients: number; valuePence: number }[];
  days: PerfGroupDay[];
  totals: {
    practitioners: number;
    daysWorked: number;
    availableHours: number;
    utilisedHours: number;
    unusedHours: number;
    utilisationPct: number | null;
    patientAppts: number;
    treatments: number | null;
    treatmentValuePence: number | null;
    revenuePence: number | null;
    revenuePerUtilisedHourPence: number | null;
    revenuePerAvailableHourPence: number | null;
  };
  practitioners: PerfPractitioner[];
}

export function getPractitionerPerformance(opts: {
  since: string;
  until: string;
  practiceId?: string | null;
  basis?: UtilBasis;
}): Promise<PractitionerPerformance> {
  const params = new URLSearchParams({ since: opts.since, until: opts.until });
  if (opts.practiceId) params.set('practice_id', opts.practiceId);
  if (opts.basis) params.set('basis', opts.basis);
  // The leading `?` is added HERE, once. A helper that returned the query
  // string without it and a caller that forgot to add one is how the Facebook
  // panel 404'd into a silent empty state.
  return api<PractitionerPerformance>(`/api/chair-utilisation/practitioners/performance?${params}`);
}
