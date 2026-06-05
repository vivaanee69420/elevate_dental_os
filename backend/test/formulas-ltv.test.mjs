// ltvFromBaseline — derives calculateLTV inputs from the Business Health
// baseline (revenue/profit in whole pounds; active_patients / new_per_month).
import { describe, it, expect } from 'vitest';
import { calculateLTV, ltvFromBaseline } from '../src/lib/formulas.js';

describe('calculateLTV', () => {
  it('lifetime net profit in pence from explicit inputs', () => {
    // £850/yr × 7yr × 15% = £892.50 -> 89250 pence
    expect(calculateLTV({ averageAnnualSpendPence: 85000, averageRetentionYears: 7, netMarginPct: 15 }))
      .toBe(89250);
  });
});

describe('ltvFromBaseline', () => {
  it('derives spend/patient, tenure (Little\'s law) and margin from the baseline', () => {
    // revenue £1,200,000, profit £240,000 (20% margin), 6000 active patients,
    // 100 new/month -> annual spend = £200/patient = 20000 pence;
    // tenure = 6000 / (100*12) = 5 years; LTV = 20000 × 5 × 0.20 = 20000 pence.
    const baseline = { revenue: 1_200_000, profit: 240_000, active_patients: 6000, new_per_month: 100 };
    expect(ltvFromBaseline(baseline)).toBe(20000);
  });

  it('returns 0 when patient counts or revenue are missing', () => {
    expect(ltvFromBaseline(null)).toBe(0);
    expect(ltvFromBaseline({ revenue: 1_000_000, profit: 200_000, active_patients: 0, new_per_month: 50 })).toBe(0);
    expect(ltvFromBaseline({ revenue: 1_000_000, profit: 200_000, active_patients: 5000, new_per_month: 0 })).toBe(0);
    expect(ltvFromBaseline({ revenue: 0, profit: 0, active_patients: 5000, new_per_month: 50 })).toBe(0);
  });
});
