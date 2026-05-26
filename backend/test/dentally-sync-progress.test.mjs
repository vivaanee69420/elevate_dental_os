// ============================================================================
// Page-weighted sync progress. The bar used to weight patients/appointments/
// payments as a flat 1/3 each, so a phase with 5x more pages crawled while the
// headline % disagreed with the visible "page X of Y". weightedPct() instead
// weights by each resource's real page count (probed up front).
// ============================================================================
import { describe, it, expect } from 'vitest';

const { __test } = await import('../src/lib/integrations/dentally-sync.js');
const { weightedPct, reportPct } = __test;

// A realistic shape: appointments dwarf patients/payments.
const TOTALS = [277, 1326, 300]; // patients, appointments, payments — grand 1903

describe('weightedPct — page-weighted overall progress', () => {
  it('start of patients is ~0%, not a third of the bar', () => {
    expect(weightedPct(0, 1, TOTALS)).toBe(0);
  });

  it('appointments page 129/1326 reads ~21% (overall), not the old equal-thirds 37%', () => {
    // done = 277 + 129 = 406; 406/1903 = 21%. The old (idx+frac)/3 model gave 37%.
    expect(weightedPct(1, 129, TOTALS)).toBe(21);
  });

  it('is monotonic across a phase boundary (end of patients <= start of appointments)', () => {
    const endPatients = weightedPct(0, 277, TOTALS);
    const startAppts = weightedPct(1, 1, TOTALS);
    expect(startAppts).toBeGreaterThanOrEqual(endPatients);
  });

  it('caps the in-phase page at the probed total (a phase returning extra pages cannot overshoot)', () => {
    // page 2000 > 1326 probed → counted as 1326. done = 277+1326 = 1603 → 84%.
    expect(weightedPct(1, 2000, TOTALS)).toBe(84);
  });

  it('never reports 100 before the caller marks done', () => {
    expect(weightedPct(2, 99999, TOTALS)).toBe(99);
  });

  it('guards a zero grand total (all phases empty) instead of dividing by zero', () => {
    expect(weightedPct(0, 1, [0, 0, 0])).toBe(0);
  });
});

// ============================================================================
// Regression: the bar froze at 0% for the entire patients phase. The up-front
// probe under-counts patients when Dentally omits meta.total_pages (falls back
// to 1) or when the heavy updated_since=2005 probe times out (0). weightedPct's
// Math.min(page, total) then clamped the patients contribution to ~1 page while
// the phase actually pulled hundreds — so the bar never moved off 0%.
// reportPct grows the phase total from the live pull so it can't freeze.
// ============================================================================
describe('reportPct — live-grown totals prevent a frozen bar', () => {
  it('OLD bug: with a probe that under-counts patients as 1 page, page 277 still reads 0%', () => {
    // appts/pays dominate grandTotal; patients clamped at min(277,1)=1 → 1/801 → 0%.
    expect(weightedPct(0, 277, [1, 500, 300])).toBe(0);
  });

  it('moves off 0% as the patients pull pages, even when the probe under-counted', () => {
    const totals = [1, 500, 300]; // probe under-counted patients as 1 page
    expect(reportPct(totals, 0, 1, null)).toBe(0);          // first page still ~0
    const at50 = reportPct(totals, 0, 50, null);
    const at277 = reportPct(totals, 0, 277, null);
    expect(at50).toBeGreaterThan(0);                        // no longer frozen
    expect(at277).toBeGreaterThan(at50);                    // keeps climbing
  });

  it('self-corrects from the live total_pages when Dentally does return it', () => {
    const totals = [0, 500, 300]; // probe timed out → patients total 0
    // a live page reports its real total_pages → phase total grows to it
    reportPct(totals, 0, 1, 277);
    expect(totals[0]).toBe(277);                       // phase total self-corrected
    expect(reportPct(totals, 0, 100, 277)).toBeGreaterThan(0); // and the bar advances
  });

  it('stays monotonic across the patients→appointments boundary after growing', () => {
    const totals = [1, 500, 300];
    const endPatients = reportPct(totals, 0, 277, null); // grows patients to 277
    const startAppts = reportPct(totals, 1, 1, null);
    expect(startAppts).toBeGreaterThanOrEqual(endPatients);
  });
});
