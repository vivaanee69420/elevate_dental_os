// Operations-section mock-data layer.
//
// Mirrors the fixtures hard-coded in preview/elevate-dental-os-v2.html for the
// Operations screens that are still mock-backed (uda). The Associates, Treatment
// Mix, Pay Run and Staff screens are wired to live endpoints (associates-api /
// treatments-api / pay-api / staff-api), so their fixtures were removed.
// The shared @/features/_mock module is frozen and does not expose a
// `formatPoundsCompact` helper, so it lives here, scoped to this feature.
//
// Convention: amounts are WHOLE POUNDS (matches the prototype's arithmetic),
// consistent with @/features/_mock.

import { formatPounds } from '@/features/_mock';

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
