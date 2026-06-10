// Growth section mock-data layer.
//
// Mirrors the gzip-encoded DATASET embedded in
// preview/elevate-dental-os-v2.html (decoded once at build time and frozen
// here as plain literals) plus the per-page inline arrays the prototype
// declares in PAGES.{loyalty,reviews,booking,benchmark}. Whole-pound
// amounts, matching the prototype's arithmetic and the shared _mock
// convention. Swap to real endpoints (marketing analytics, membership
// billing, review aggregator, booking widget) when they exist server-side.
//
// Frozen-primitive note: formatPounds / formatPoundsCompact come from
// @/features/_mock; this file only holds fixtures and derived shapes.

/** A marketing lead source (last 30 days), from DATASET.source_summary. */
export interface SourceRow {
  name: string;
  leads: number;
  converted: number;
  pipeline_value: number;
  conversion_rate: number;
}

/** A treatment-mix row (last 30 days), from DATASET.treatment_summary. */
export interface TreatmentRow {
  name: string;
  leads: number;
  pipeline_value: number;
}

/** A per-practice 30-day performance row, from DATASET.practice_summary. */
export interface PracticeRow {
  name: string;
  leads_30d: number;
  consults_30d: number;
  treatments_30d: number;
  pipeline_value: number;
  conversion_rate: number;
  revenue_30d: number;
}

/** Marketing source performance, last 30 days (DATASET.source_summary). */
export const SOURCE_SUMMARY: SourceRow[] = [
  { name: 'Website Form', leads: 87, converted: 10, pipeline_value: 166400, conversion_rate: 11.5 },
  { name: 'Meta Lead Ad', leads: 104, converted: 10, pipeline_value: 232150, conversion_rate: 9.6 },
  { name: 'Google Ads', leads: 90, converted: 8, pipeline_value: 175900, conversion_rate: 8.9 },
  { name: 'Patient Referral', leads: 80, converted: 12, pipeline_value: 197050, conversion_rate: 15 },
  { name: 'Phone Enquiry', leads: 40, converted: 6, pipeline_value: 115550, conversion_rate: 15 },
];

/** Treatment-mix pipeline, last 30 days (DATASET.treatment_summary). */
export const TREATMENT_SUMMARY: TreatmentRow[] = [
  { name: 'All-on-4 Implants', leads: 30, pipeline_value: 319000 },
  { name: 'Single Tooth Implant', leads: 81, pipeline_value: 162450 },
  { name: 'Invisalign', leads: 84, pipeline_value: 231000 },
  { name: 'Composite Bonding', leads: 61, pipeline_value: 51600 },
  { name: 'Porcelain Veneers', leads: 50, pipeline_value: 88800 },
  { name: 'Teeth Whitening', leads: 95, pipeline_value: 34200 },
];

/** Per-practice 30-day performance (DATASET.practice_summary). */
export const PRACTICE_SUMMARY: PracticeRow[] = [
  { name: 'Ashford Dental', leads_30d: 83, consults_30d: 48, treatments_30d: 10, pipeline_value: 155950, conversion_rate: 12, revenue_30d: 69225 },
  { name: 'Rochester Dental', leads_30d: 64, consults_30d: 41, treatments_30d: 6, pipeline_value: 89950, conversion_rate: 9.4, revenue_30d: 64297 },
  { name: 'Barnet Dental', leads_30d: 64, consults_30d: 38, treatments_30d: 9, pipeline_value: 106600, conversion_rate: 14.1, revenue_30d: 67897 },
  { name: 'Warwick Lodge Implant Centre', leads_30d: 89, consults_30d: 49, treatments_30d: 10, pipeline_value: 221400, conversion_rate: 11.2, revenue_30d: 71137 },
  { name: 'Fixed Teeth Solutions Bexleyheath', leads_30d: 101, consults_30d: 56, treatments_30d: 11, pipeline_value: 313150, conversion_rate: 10.9, revenue_30d: 77662 },
];

// ── Loyalty ────────────────────────────────────────────────────────────────

// Loyalty & Membership data is served live from GET /api/growth/loyalty
// (see features/growth/loyalty-api.ts). The former LOYALTY_PROGRAMS /
// LOYALTY_REWARDS mock arrays were removed when the page went real-data.

// ── Reviews ──────────────────────────────────────────────────────────────────

/** A single recent review (PAGES.reviews inline array). */
export interface ReviewRow {
  source: string;
  practice: string;
  author: string;
  rating: number;
  time: string;
  text: string;
  responded: boolean;
}

export const REVIEWS: ReviewRow[] = [
  { source: 'Google', practice: 'Warwick Lodge', author: 'Sarah J.', rating: 5, time: '2h ago', text: 'Dr Mehta and the team gave me my smile back with All-on-4. Life changing. Cannot recommend enough.', responded: true },
  { source: 'Google', practice: 'Ashford', author: 'Tom W.', rating: 4, time: '1d ago', text: 'Great hygiene appointment, friendly staff. Slight wait at reception but otherwise excellent.', responded: true },
  { source: 'Trustpilot', practice: 'Rochester', author: 'Emma K.', rating: 5, time: '2d ago', text: 'Best dental practice I have been to. The hygienist was so thorough.', responded: true },
  { source: 'Google', practice: 'Barnet', author: 'Anonymous', rating: 2, time: '3d ago', text: 'Felt rushed at my last visit. Hope it improves next time.', responded: false },
  { source: 'Google', practice: 'Bexleyheath', author: 'M. Chen', rating: 5, time: '4d ago', text: 'Fixed Teeth Solutions delivered exactly that. Painless implant procedure. Highly skilled team.', responded: true },
  { source: 'Trustpilot', practice: 'Warwick Lodge', author: 'David H.', rating: 5, time: '5d ago', text: 'Complete game changer. Six months on and still smiling.', responded: true },
];

/** A reviews-by-source aggregate row. */
export const REVIEWS_BY_SOURCE = [
  { name: 'Google Business', count: 1240, rating: 4.7 },
  { name: 'Trustpilot', count: 380, rating: 4.6 },
  { name: 'Facebook', count: 142, rating: 4.8 },
  { name: 'Treatwell', count: 78, rating: 4.5 },
];

/** A reviews-by-practice aggregate row. */
export const REVIEWS_BY_PRACTICE = [
  { name: 'Warwick Lodge', rating: 4.9, count: 480 },
  { name: 'Ashford', rating: 4.7, count: 420 },
  { name: 'Rochester', rating: 4.6, count: 380 },
  { name: 'Bexleyheath', rating: 4.8, count: 320 },
  { name: 'Barnet', rating: 4.5, count: 240 },
];

export const REVIEWS_TOTAL = 1840;

// ── Booking ──────────────────────────────────────────────────────────────────

/** A recent online booking (PAGES.booking inline array). */
export interface BookingRow {
  date: string;
  practice: string;
  patient: string;
  service: string;
  source: string;
  deposit: number;
  status: 'Confirmed' | 'Pending deposit';
}

export const BOOKINGS: BookingRow[] = [
  { date: '2026-05-17 10:30', practice: 'Warwick Lodge', patient: 'New patient', service: 'Implant consultation', source: 'Website', deposit: 50, status: 'Confirmed' },
  { date: '2026-05-17 11:00', practice: 'Ashford', patient: 'S. Patel', service: 'Hygiene', source: 'Member portal', deposit: 0, status: 'Confirmed' },
  { date: '2026-05-17 14:15', practice: 'Bexleyheath', patient: 'New patient', service: 'Smile consultation', source: 'Instagram link', deposit: 50, status: 'Confirmed' },
  { date: '2026-05-18 09:00', practice: 'Rochester', patient: 'L. Cooper', service: 'Bonding follow-up', source: 'Website', deposit: 0, status: 'Confirmed' },
  { date: '2026-05-18 15:30', practice: 'Warwick Lodge', patient: 'New patient', service: 'All-on-4 consultation', source: 'Google Ads', deposit: 100, status: 'Pending deposit' },
];

export const BOOKING_TOTALS = { today: 28, week: 142, month: 580, onlineSharePct: 38 };

/** Booking-source split, last 30 days. */
export const BOOKING_SOURCES = [
  { source: 'Practice website', count: 240, pct: 41 },
  { source: 'Google Ads -> landing pages', count: 142, pct: 24 },
  { source: 'Instagram link in bio', count: 78, pct: 13 },
  { source: 'Member portal (rebooking)', count: 68, pct: 12 },
  { source: 'SMS recall link', count: 38, pct: 7 },
  { source: 'Google Business Profile button', count: 14, pct: 3 },
];

/** Booking-widget configuration rows. */
export const BOOKING_SETTINGS = [
  { label: 'Deposit required (consults)', value: '£50 (refundable)' },
  { label: 'Deposit required (All-on-4)', value: '£100 (refundable)' },
  { label: 'Minimum advance booking', value: '2 hours' },
  { label: 'Cancellation window', value: '24 hours' },
];

// ── Benchmark ────────────────────────────────────────────────────────────────

/** GM Dental's figures and the UK 2024-25 industry averages. */
export const BENCHMARK_YOU = {
  revenue_per_chair: 20400,
  ebitda_margin: 10.0,
  conversion: 11.5,
  fta_rate: 4.2,
  associate_pay_pct: 46,
  staff_cost_pct: 17,
  lab_pct: 16,
  avg_case_value: 2850,
};

export const BENCHMARK_UK = {
  revenue_per_chair: 22000,
  ebitda_margin: 14.6,
  conversion: 18,
  fta_rate: 8,
  associate_pay_pct: 45,
  staff_cost_pct: 18,
  lab_pct: 15,
  avg_case_value: 1850,
};

/** One benchmark comparison metric (label + direction + unit). */
export interface BenchmarkMetric {
  label: string;
  you: number;
  avg: number;
  positiveBetter: boolean;
  unit: '£' | '%' | '';
}

export const BENCHMARK_METRICS: BenchmarkMetric[] = [
  { label: 'Revenue/chair (monthly)', you: BENCHMARK_YOU.revenue_per_chair, avg: BENCHMARK_UK.revenue_per_chair, positiveBetter: true, unit: '£' },
  { label: 'EBITDA margin', you: BENCHMARK_YOU.ebitda_margin, avg: BENCHMARK_UK.ebitda_margin, positiveBetter: true, unit: '%' },
  { label: 'Lead-to-treatment conversion', you: BENCHMARK_YOU.conversion, avg: BENCHMARK_UK.conversion, positiveBetter: true, unit: '%' },
  { label: 'FTA rate', you: BENCHMARK_YOU.fta_rate, avg: BENCHMARK_UK.fta_rate, positiveBetter: false, unit: '%' },
  { label: 'Associate pay %', you: BENCHMARK_YOU.associate_pay_pct, avg: BENCHMARK_UK.associate_pay_pct, positiveBetter: false, unit: '%' },
  { label: 'Staff cost %', you: BENCHMARK_YOU.staff_cost_pct, avg: BENCHMARK_UK.staff_cost_pct, positiveBetter: false, unit: '%' },
  { label: 'Lab + materials %', you: BENCHMARK_YOU.lab_pct, avg: BENCHMARK_UK.lab_pct, positiveBetter: false, unit: '%' },
  { label: 'Avg case value', you: BENCHMARK_YOU.avg_case_value, avg: BENCHMARK_UK.avg_case_value, positiveBetter: true, unit: '£' },
];

/** Top quartile improvement opportunities (PAGES.benchmark). */
export const BENCHMARK_OPPORTUNITIES = [
  { title: 'Improve conversion 11.5% -> 18%', detail: 'Better consult process · train front desk team', uplift: 420000 },
  { title: 'Lift EBITDA margin 10% -> 14.6%', detail: 'Focus on lab cost + associate efficiency', uplift: 212000 },
  { title: 'Reduce lab 16% -> 15%', detail: 'Route more through GM Dental Lab · negotiate group rate', uplift: 46000 },
];
