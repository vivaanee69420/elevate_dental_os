// ============================================================================
// Cash runway — calculateRunway (Intelligence OS — Cashflow & Runway). Integer
// pence. Free cash vs monthly burn; cash-positive ⇒ no finite runway.
// ============================================================================

import { describe, it, expect } from 'vitest';
import { calculateRunway } from '../src/lib/formulas.js';

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
