// ============================================================================
// Revenue Leakage — calculateRevenueLeakage. Five recoverable pools in integer
// pence, each scaled by a 0-100 recoverable rate. Mirrors the GM demo's
// leakageModel but driven by real rollups. Pure; window-total in, window-total
// out (annualisation is the caller's job).
// ============================================================================

import { describe, it, expect } from 'vitest';
import {
  calculateRevenueLeakage,
  LEAKAGE_DEFAULT_RATES,
  LEAKAGE_HYGIENE_SHARE,
  LEAKAGE_LAPSED_SHARE,
} from '../src/lib/formulas.js';

describe('calculateRevenueLeakage', () => {
  const base = {
    revenuePence: 100_000_00, // £100,000 window turnover
    presentedPlanPence: 50_000_00,
    acceptedPlanPence: 30_000_00, // £20,000 lost plans
    appointments: 1000,
    noShows: 100, // 10% FTA
    cashCollectedPence: 90_000_00, // £10,000 uncollected
  };

  it('computes each pool at the default rates', () => {
    const { pools } = calculateRevenueLeakage(base);
    // plans: lost 20,000_00 * 30% = 6,000_00
    expect(pools.plans).toBe(6_000_00);
    // fta: 100,000_00 * 0.10 * 50% = 5,000_00
    expect(pools.fta).toBe(5_000_00);
    // recall: 100,000_00 * 0.12 * 0.25 * 60% = 1,800_00
    expect(pools.recall).toBe(Math.round(100_000_00 * LEAKAGE_HYGIENE_SHARE * 0.25 * 0.6));
    // lapsed: 100,000_00 * 0.06 * 40% = 2,400_00
    expect(pools.lapsed).toBe(Math.round(100_000_00 * LEAKAGE_LAPSED_SHARE * 0.4));
    // collect: 10,000_00 * 70% = 7,000_00
    expect(pools.collect).toBe(7_000_00);
  });

  it('windowTotal is the sum of the five pools', () => {
    const { pools, windowTotalPence } = calculateRevenueLeakage(base);
    expect(windowTotalPence).toBe(
      pools.plans + pools.fta + pools.recall + pools.lapsed + pools.collect,
    );
  });

  it('reports the FTA rate as a percentage', () => {
    const { ftaRatePct } = calculateRevenueLeakage(base);
    expect(ftaRatePct).toBe(10);
  });

  it('clamps rates to 0-100 and floors negatives', () => {
    const { pools } = calculateRevenueLeakage(base, { plans: 200, collect: -50 });
    expect(pools.plans).toBe(20_000_00); // 200 clamped to 100% → full lost value
    expect(pools.collect).toBe(0); // negative clamped to 0
  });

  it('never produces negative pools (accepted > presented, cash > revenue)', () => {
    const { pools } = calculateRevenueLeakage({
      revenuePence: 10_000_00,
      presentedPlanPence: 1_000_00,
      acceptedPlanPence: 5_000_00, // accepted exceeds presented
      cashCollectedPence: 20_000_00, // over-collected
      appointments: 0,
      noShows: 0,
    });
    expect(pools.plans).toBe(0);
    expect(pools.collect).toBe(0);
    expect(pools.fta).toBe(0); // no appointments → no FTA rate
  });

  it('zero input yields zero leakage', () => {
    const { windowTotalPence } = calculateRevenueLeakage({});
    expect(windowTotalPence).toBe(0);
  });

  it('exposes the default rate table', () => {
    expect(LEAKAGE_DEFAULT_RATES).toEqual({ plans: 30, fta: 50, recall: 60, lapsed: 40, collect: 70 });
  });
});
