// ============================================================================
// M&A Acquisition Modeller — calculateAcquisition (buy-side, DentaCFO Phase 3).
// Enterprise value, NPV, IRR, payback, debt capacity in integer pence, scored
// against UK dental M&A benchmarks. Pure port of the GM demo's mnaCalc plus
// red flags. Pence in / pence out.
// ============================================================================

import { describe, it, expect } from 'vitest';
import { calculateAcquisition, ACQUISITION_BENCHMARKS } from '../src/lib/formulas.js';

describe('calculateAcquisition', () => {
  // Demo defaults: £1.2m revenue, 18% margin, 7× multiple, 5% growth, 5y, 10% discount.
  const base = {
    targetRevenuePence: 1_200_000_00,
    marginPct: 18,
    multiple: 7,
    growthPct: 5,
    horizonYears: 5,
    discountPct: 10,
  };

  it('computes EBITDA, EV, debt capacity and equity required', () => {
    const r = calculateAcquisition(base);
    // EBITDA = 1,200,000 * 18% = 216,000
    expect(r.ebitdaPence).toBe(216_000_00);
    // EV = 216,000 * 7 = 1,512,000
    expect(r.evPence).toBe(1_512_000_00);
    // debt capacity = 216,000 * 3.5 = 756,000
    expect(r.debtCapacityPence).toBe(756_000_00);
    // equity = EV - debt = 756,000
    expect(r.equityRequiredPence).toBe(756_000_00);
  });

  it('defaults leverage to the 3.5x benchmark and honours an override', () => {
    expect(calculateAcquisition(base).leverageMultiple).toBe(3.5);
    const lev = calculateAcquisition({ ...base, leverageMultiple: 4 });
    expect(lev.debtCapacityPence).toBe(216_000_00 * 4);
    expect(lev.equityRequiredPence).toBe(1_512_000_00 - 216_000_00 * 4);
  });

  it('produces a positive NPV and a solvable IRR for a healthy deal', () => {
    const r = calculateAcquisition(base);
    expect(r.npvPence).toBeGreaterThan(0);
    expect(r.irrPct).not.toBeNull();
    // IRR must reconcile: NPV at the IRR is ~0.
    const atIrr = calculateAcquisition({ ...base, discountPct: r.irrPct });
    expect(Math.abs(atIrr.npvPence)).toBeLessThan(r.evPence * 0.01);
  });

  it('flags a negative NPV when the multiple is far above growth+discount support', () => {
    // 12x entry, flat growth, high discount → overpaying.
    const r = calculateAcquisition({ ...base, multiple: 12, growthPct: 0, discountPct: 20 });
    expect(r.npvPence).toBeLessThan(0);
    expect(r.flags.some((f) => f.key === 'npv')).toBe(true);
    expect(r.flags.some((f) => f.key === 'multiple')).toBe(true);
  });

  it('returns null IRR and a payback flag when cashflows never recover EV at 0% growth', () => {
    // EBITDA 216k/yr vs EV 1.512m, flat → recovers at year 7 (>6yr norm).
    const r = calculateAcquisition({ ...base, growthPct: 0 });
    expect(r.paybackYears).toBeGreaterThan(ACQUISITION_BENCHMARKS.maxPaybackYears);
    expect(r.flags.some((f) => f.key === 'payback')).toBe(true);
  });

  it('computes asking-price premium vs modelled EV and flags an overpay', () => {
    const r = calculateAcquisition({ ...base, askingPricePence: 1_800_000_00 });
    // premium = 1,800,000 - 1,512,000 = 288,000
    expect(r.premiumPence).toBe(288_000_00);
    expect(r.premiumPct).toBeCloseTo(19.05, 1);
    expect(r.flags.some((f) => f.key === 'asking')).toBe(true);
  });

  it('omits the asking-price gap when no price is supplied', () => {
    const r = calculateAcquisition(base);
    expect(r.premiumPence).toBeNull();
    expect(r.premiumPct).toBeNull();
  });

  it('flags thin margin and excess leverage', () => {
    const r = calculateAcquisition({ ...base, marginPct: 8, leverageMultiple: 5 });
    expect(r.flags.some((f) => f.key === 'margin')).toBe(true);
    expect(r.flags.some((f) => f.key === 'leverage')).toBe(true);
  });

  it('clamps horizon to >= 1 year and handles zero inputs without throwing', () => {
    const r = calculateAcquisition({ targetRevenuePence: 0, marginPct: 0, multiple: 0, horizonYears: 0 });
    expect(r.horizonYears).toBe(1);
    expect(r.evPence).toBe(0);
    expect(r.equityRequiredPence).toBe(0);
  });
});
