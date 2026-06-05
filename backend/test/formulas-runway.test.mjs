// ============================================================================
// Cash runway — calculateRunway (Intelligence OS — Cashflow & Runway). Integer
// pence. Free cash vs monthly burn; cash-positive ⇒ no finite runway.
// ============================================================================

import { describe, it, expect } from 'vitest';
import { calculateRunway, estimateCorporationTax, freeCashDecision } from '../src/lib/formulas.js';

describe('calculateRunway', () => {
  it('burning cash: runway = free cash / monthly burn', () => {
    const r = calculateRunway({
      cashOnHandPence: 30_000_000, // £300k
      monthlyReceiptsPence: 8_000_000, // £80k
      monthlyCostsPence: 10_000_000, // £100k
    });
    expect(r.monthlyNetPence).toBe(-2_000_000); // burning £20k/mo
    expect(r.monthlyBurnPence).toBe(2_000_000);
    expect(r.cashPositive).toBe(false);
    expect(r.runwayMonths).toBe(15); // 300k / 20k
    expect(r.status).toBe('healthy'); // >= 6 months
  });

  it('cash-positive: no finite runway', () => {
    const r = calculateRunway({
      cashOnHandPence: 30_000_000,
      monthlyReceiptsPence: 12_000_000,
      monthlyCostsPence: 10_000_000,
    });
    expect(r.monthlyNetPence).toBe(2_000_000);
    expect(r.cashPositive).toBe(true);
    expect(r.monthlyBurnPence).toBe(0);
    expect(r.runwayMonths).toBeNull();
    expect(r.status).toBe('healthy');
  });

  it('status thresholds: < 3 months critical, < 6 warning', () => {
    const critical = calculateRunway({ cashOnHandPence: 5_000_000, monthlyReceiptsPence: 0, monthlyCostsPence: 2_000_000 });
    expect(critical.runwayMonths).toBe(2.5);
    expect(critical.status).toBe('critical');
    const warning = calculateRunway({ cashOnHandPence: 10_000_000, monthlyReceiptsPence: 0, monthlyCostsPence: 2_000_000 });
    expect(warning.runwayMonths).toBe(5);
    expect(warning.status).toBe('warning');
  });

  it('free cash equals cash on hand; defaults are zero-safe', () => {
    const r = calculateRunway({ cashOnHandPence: 1_234_567 });
    expect(r.freeCashPence).toBe(1_234_567);
    expect(r.monthlyReceiptsPence).toBe(0);
    expect(r.monthlyCostsPence).toBe(0);
    expect(r.cashPositive).toBe(true); // net 0 >= 0
    expect(r.runwayMonths).toBeNull();
  });

  it('no args → all zero, cash-positive, null runway', () => {
    const r = calculateRunway();
    expect(r.freeCashPence).toBe(0);
    expect(r.cashPositive).toBe(true);
    expect(r.runwayMonths).toBeNull();
  });
});

describe('estimateCorporationTax — UK FY2024/25 (hand-verified)', () => {
  it('small-profits 19% at or below £50k', () => {
    expect(estimateCorporationTax(50_000_00)).toBe(9_500_00); // 19%
    expect(estimateCorporationTax(20_000_00)).toBe(3_800_00);
  });

  it('main 25% at or above £250k', () => {
    expect(estimateCorporationTax(250_000_00)).toBe(62_500_00); // 25%
    expect(estimateCorporationTax(400_000_00)).toBe(100_000_00);
  });

  it('marginal relief band between £50k and £250k', () => {
    // £100k: 25% = 25,000 ; relief = (250k-100k)*3/200 = 2,250 ; tax = 22,750
    expect(estimateCorporationTax(100_000_00)).toBe(22_750_00);
  });

  it('zero / negative profit → no tax', () => {
    expect(estimateCorporationTax(0)).toBe(0);
    expect(estimateCorporationTax(-5_000_00)).toBe(0);
  });
});

describe('freeCashDecision — buffer + sweep', () => {
  it('lowest point clears buffer → sweepable above buffer', () => {
    const d = freeCashDecision({
      cashOnHandPence: 30_000_000, // £300k
      monthlyCostsPence: 10_000_000, // £100k/mo
      lowestProjectedPence: 25_000_000, // £250k low
      bufferWeeks: 2,
    });
    // buffer = 100k * (12/52) * 2 ≈ £46,153.85
    expect(d.bufferPence).toBe(Math.round((10_000_000 * 12 / 52) * 2));
    expect(d.lowClearsBuffer).toBe(true);
    expect(d.action).toBe('sweep');
    expect(d.sweepablePence).toBe(25_000_000 - d.bufferPence);
  });

  it('lowest point below buffer → build the buffer first', () => {
    const d = freeCashDecision({
      cashOnHandPence: 5_000_000,
      monthlyCostsPence: 20_000_000,
      lowestProjectedPence: 1_000_000,
      bufferWeeks: 2,
    });
    expect(d.lowClearsBuffer).toBe(false);
    expect(d.action).toBe('build_buffer');
    expect(d.sweepablePence).toBe(0);
  });
});
