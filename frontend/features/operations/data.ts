// Operations-section mock-data layer.
//
// Mirrors the fixtures hard-coded in preview/elevate-dental-os-v2.html for the
// six Operations screens (associates, staff, pay, chair, treatments, uda).
// The shared @/features/_mock module is frozen and does not expose a
// `formatPoundsCompact` helper nor a treatment-level leads fixture, so those
// live here, scoped to this feature. When real endpoints land, screens swap
// their data source; these contracts stay stable.
//
// Convention: amounts are WHOLE POUNDS (matches the prototype's arithmetic),
// consistent with @/features/_mock. Pence conversion happens at the future
// backend-swap point, not here.

import { seededRandom, pick, formatPounds } from '@/features/_mock';

// Re-export the shared whole-pound formatter so operations screens can pull
// both money helpers from one module.
export { formatPounds };

/**
 * Compact British currency, mirroring the prototype's formatPoundsCompact:
 * >= £1M -> "£1.2M", >= £1k -> "£412k", else "£840". en-GB rule honoured.
 */
export function formatPoundsCompact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return '£' + (n / 1_000_000).toFixed(1) + 'M';
  if (Math.abs(n) >= 1_000) return '£' + Math.round(n / 1_000) + 'k';
  return '£' + Math.round(n);
}

/** A single associate clinician row (Associates + Pay Run screens). */
export interface Associate {
  name: string;
  practice: string;
  joined: string; // YYYY-MM
  pay_pct: number;
  ttm_production: number; // whole pounds
  ttm_uda: number;
  conversion: number; // percent
  treatments: number;
  status: 'top' | 'good' | 'review';
}

/** Roster of associate clinicians — verbatim from the prototype. */
export const ASSOCIATES: Associate[] = [
  { name: 'Dr Sarah Mitchell', practice: 'Warwick Lodge', joined: '2021-03', pay_pct: 50, ttm_production: 412000, ttm_uda: 0, conversion: 28, treatments: 84, status: 'top' },
  { name: 'Dr James Roberts', practice: 'Ashford', joined: '2019-07', pay_pct: 47, ttm_production: 385000, ttm_uda: 4200, conversion: 22, treatments: 71, status: 'top' },
  { name: 'Dr Priya Sharma', practice: 'Rochester', joined: '2022-09', pay_pct: 45, ttm_production: 298000, ttm_uda: 5800, conversion: 19, treatments: 52, status: 'good' },
  { name: 'Dr Michael Chen', practice: 'Bexleyheath', joined: '2020-11', pay_pct: 50, ttm_production: 445000, ttm_uda: 0, conversion: 31, treatments: 89, status: 'top' },
  { name: 'Dr Emma Wilson', practice: 'Barnet', joined: '2023-02', pay_pct: 45, ttm_production: 187000, ttm_uda: 3600, conversion: 14, treatments: 38, status: 'review' },
  { name: 'Dr Thomas Brown', practice: 'Ashford', joined: '2018-04', pay_pct: 48, ttm_production: 342000, ttm_uda: 3900, conversion: 20, treatments: 63, status: 'good' },
  { name: 'Dr Aisha Khan', practice: 'Warwick Lodge', joined: '2022-01', pay_pct: 50, ttm_production: 368000, ttm_uda: 0, conversion: 26, treatments: 74, status: 'good' },
  { name: 'Dr Daniel Patel', practice: 'Rochester', joined: '2024-06', pay_pct: 42, ttm_production: 142000, ttm_uda: 4100, conversion: 12, treatments: 28, status: 'review' },
];

/** Raw pay-run inputs (gross/net are derived in PayScreen). */
export interface PayRunInput {
  name: string;
  practice: string;
  pay_pct: number;
  lab_pct: number;
  period_prod: number; // whole pounds
  period_lab: number; // whole pounds
  prev: number; // prior-period adjustment, whole pounds
}

/** May 2026 draft pay-run inputs — verbatim from the prototype. */
export const PAY_RUN_INPUTS: PayRunInput[] = [
  { name: 'Dr Sarah Mitchell', practice: 'Warwick Lodge', pay_pct: 50, lab_pct: 50, period_prod: 38500, period_lab: 5400, prev: 0 },
  { name: 'Dr James Roberts', practice: 'Ashford', pay_pct: 47, lab_pct: 50, period_prod: 32100, period_lab: 3200, prev: -250 },
  { name: 'Dr Priya Sharma', practice: 'Rochester', pay_pct: 45, lab_pct: 50, period_prod: 24800, period_lab: 2900, prev: 0 },
  { name: 'Dr Michael Chen', practice: 'Bexleyheath', pay_pct: 50, lab_pct: 50, period_prod: 41200, period_lab: 6800, prev: 0 },
  { name: 'Dr Emma Wilson', practice: 'Barnet', pay_pct: 45, lab_pct: 50, period_prod: 15600, period_lab: 1800, prev: 0 },
  { name: 'Dr Thomas Brown', practice: 'Ashford', pay_pct: 48, lab_pct: 50, period_prod: 28500, period_lab: 3400, prev: 0 },
  { name: 'Dr Aisha Khan', practice: 'Warwick Lodge', pay_pct: 50, lab_pct: 50, period_prod: 30700, period_lab: 4200, prev: 0 },
  { name: 'Dr Daniel Patel', practice: 'Rochester', pay_pct: 42, lab_pct: 50, period_prod: 11800, period_lab: 1400, prev: 0 },
];

/** One scheduled staff member (Staff Scheduling screen). */
export interface StaffMember {
  name: string;
  role: string;
  practice: string;
  hours_week: number;
  rate: number; // £/hour
  scheduled: number; // hours scheduled this week
  attendance: number; // percent
}

/** This week's staff roster — verbatim from the prototype. */
export const STAFF: StaffMember[] = [
  { name: 'Anna (Reception)', role: 'Front desk', practice: 'Warwick Lodge', hours_week: 38, rate: 13.5, scheduled: 38, attendance: 100 },
  { name: 'Maria (Nurse)', role: 'Dental nurse', practice: 'Warwick Lodge', hours_week: 40, rate: 14.2, scheduled: 40, attendance: 98 },
  { name: 'Becky (Hygienist)', role: 'Hygienist', practice: 'Ashford', hours_week: 32, rate: 32.0, scheduled: 32, attendance: 100 },
  { name: 'James (Nurse)', role: 'Dental nurse', practice: 'Ashford', hours_week: 36, rate: 14.0, scheduled: 36, attendance: 94 },
  { name: 'Priya (TCO)', role: 'Treatment coordinator', practice: 'Rochester', hours_week: 40, rate: 15.5, scheduled: 40, attendance: 100 },
  { name: 'Tom (Manager)', role: 'Practice manager', practice: 'Bexleyheath', hours_week: 40, rate: 18.0, scheduled: 40, attendance: 100 },
  { name: 'Sophie (Reception)', role: 'Front desk', practice: 'Barnet', hours_week: 30, rate: 13.0, scheduled: 30, attendance: 96 },
  { name: 'Daniel (Nurse)', role: 'Dental nurse', practice: 'Rochester', hours_week: 38, rate: 13.8, scheduled: 38, attendance: 100 },
];

/** One NHS-contracted practice's UDA delivery (UDA Tracker screen). */
export interface PracticeUda {
  name: string;
  contract: number;
  delivered: number;
  rate: number; // £/UDA
}

/** Per-practice UDA delivery — verbatim from the prototype. */
export const PRACTICE_UDA: PracticeUda[] = [
  { name: 'Ashford Dental', contract: 8000, delivered: 4900, rate: 28.5 },
  { name: 'Rochester Dental', contract: 12000, delivered: 7200, rate: 27.0 },
  { name: 'Barnet Dental', contract: 6000, delivered: 3100, rate: 28.0 },
  { name: 'Bexleyheath', contract: 6000, delivered: 3200, rate: 26.5 },
];

/** A treatment-tagged lead, used to aggregate the Treatment Mix screen. */
export interface TreatmentLead {
  treatment: string;
  value: number; // whole pounds, average case value
  status: string;
}

// Catalogue of the prototype's six treatments with their average case value.
// (Italy Implant Residency is not a live offering — rule 6 — and never
// appears in the prototype's treatment set, so nothing to exclude here.)
const TREATMENT_CATALOGUE: { name: string; value: number }[] = [
  { name: 'All-on-4 Implants', value: 14500 },
  { name: 'Single Tooth Implant', value: 2850 },
  { name: 'Invisalign', value: 3500 },
  { name: 'Composite Bonding', value: 1200 },
  { name: 'Porcelain Veneers', value: 2400 },
  { name: 'Teeth Whitening', value: 450 },
];

const STARTED_STATUSES = ['treatment_started', 'treatment_completed'];

/**
 * Build a deterministic TTM population of treatment-tagged leads.
 *
 * The prototype's Treatment Mix page reads a 12-month gzipped dataset that is
 * not decodable here, so we synthesise an equivalent set: each treatment gets
 * a stable lead count (rarer/bigger cases lower volume) all marked as started,
 * which is exactly what the screen aggregates. Seeded -> stable across renders.
 */
export function treatmentLeads(seed = 77): TreatmentLead[] {
  const rnd = seededRandom(seed);
  const out: TreatmentLead[] = [];
  // Volume bands inversely correlated with case value, so the revenue mix is
  // realistic (implants high value/low volume; whitening low value/high vol).
  const volume: Record<string, number> = {
    'All-on-4 Implants': 22,
    'Single Tooth Implant': 41,
    Invisalign: 58,
    'Composite Bonding': 73,
    'Porcelain Veneers': 34,
    'Teeth Whitening': 96,
  };
  TREATMENT_CATALOGUE.forEach((t) => {
    const n = volume[t.name];
    for (let i = 0; i < n; i++) {
      out.push({
        treatment: t.name,
        value: t.value,
        status: pick(STARTED_STATUSES, rnd()),
      });
    }
  });
  return out;
}
