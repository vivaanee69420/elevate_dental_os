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
  availableSecs: number;
  utilisedSecs: number;
  /** null when there were no available hours — never 0%. */
  utilisationPct: number | null;
  practitioners: number;
  /** null when nothing was invoiced that day. */
  revenuePence: number | null;
}

/** EXACT seconds accompany every rounded hour figure. Anything rendered in a
 *  unit FINER than the rounding — hours and minutes, most of all — must be
 *  derived from the seconds: 255 minutes rounds to 4.3 hours, and turning that
 *  back into minutes yields "4h 18m" for a day that was really 4h 15m. */
export interface UtilPractitionerDay {
  day: string;
  /** The site this day was worked at — a practitioner can move between them. */
  practiceId: string | null;
  utilisationPct: number | null;
  availableHours: number;
  utilisedHours: number;
  availableSecs: number;
  utilisedSecs: number;
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
  availableSecs: number;
  utilisedSecs: number;
  utilisationPct: number | null;
  patientAppts: number;
  revenuePence: number | null;
  revenuePerUtilisedHourPence: number | null;
  days: UtilPractitionerDay[];
}

/** Which denominator the figures were divided by. 'rota' is the only one that
 *  is Dentally's own rather than derived from the diary. */
export type UtilBasis = 'span' | 'clinical' | 'rota';

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
    /** Rota basis only: patient time on a day the rota marks off, and days we
     *  hold no rota for. Reported so the panel reconciles rather than quietly
     *  absorbing them. Zero on the other two bases by construction. */
    offRotaDays: number;
    offRotaUtilisedHours: number;
    noRotaDays: number;
    noRotaUtilisedHours: number;
    /** Breaks inside the rostered window. The headline is GROSS of these,
     *  which is what reconciled against Dentally. */
    rotaBreakHours: number;
  };
  days: UtilDay[];
  practitioners: UtilPractitioner[];
  /** Practitioners whose diary held ONLY blocks in this window — rostered, saw
   *  nobody. Deliberately outside `practitioners` so no total can pick them up
   *  (counting them collapses the group figure), but returned so the chart's
   *  picker can offer them: "rostered and saw nobody" is the finding, and a
   *  menu that omits them hides it. Dentally's own picker lists them. */
  otherPractitioners: UtilPractitioner[];
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
