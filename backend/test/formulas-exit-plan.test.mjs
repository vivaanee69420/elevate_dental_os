// ============================================================================
// Exit Plan — calculateSaleWaterfall + calculateFirePlan (DentaCFO Phase 4).
// Personal-wealth model: what the owner nets from a practice sale (debt, equity
// split, UK CGT with BADR, freehold) and whether net worth clears the FIRE
// number (the 4% rule) plus the compounding path. Pence in / pence out.
// ============================================================================

import { describe, it, expect } from 'vitest';
import {
  calculateSaleWaterfall,
  calculateFirePlan,
  UK_TAX,
  FIRE_DEFAULTS,
} from '../src/lib/formulas.js';

describe('calculateSaleWaterfall', () => {
  it('clears debt, splits equity by ownership %, and taxes the gain', () => {
    // EV £5m, £500k debt → £4.5m equity; 100% owner; £100k base cost.
    const r = calculateSaleWaterfall({
      enterpriseValuePence: 5_000_000_00,
      businessDebtPence: 500_000_00,
      ownerSharePct: 100,
      acquisitionCostPence: 100_000_00,
    });
    expect(r.equityValuePence).toBe(4_500_000_00);
    expect(r.ownerEquityProceedsPence).toBe(4_500_000_00);
    // gain = 4.5m - 100k = 4.4m
    expect(r.ownerGainPence).toBe(4_400_000_00);
    // BADR on first £1m at 18%, remainder £3.4m at 24%
    expect(r.badrGainPence).toBe(1_000_000_00);
    expect(r.standardGainPence).toBe(3_400_000_00);
    // CGT = 1m*0.18 + 3.4m*0.24 = 180k + 816k = 996k
    expect(r.cgtPence).toBe(996_000_00);
    expect(r.netBusinessProceedsPence).toBe(4_500_000_00 - 996_000_00);
    expect(r.totalNetProceedsPence).toBe(r.netBusinessProceedsPence);
  });

  it('splits proceeds for a part-owner (50%)', () => {
    const r = calculateSaleWaterfall({
      enterpriseValuePence: 4_000_000_00,
      businessDebtPence: 0,
      ownerSharePct: 50,
      acquisitionCostPence: 0,
    });
    expect(r.ownerEquityProceedsPence).toBe(2_000_000_00);
    expect(r.ownerGainPence).toBe(2_000_000_00);
    // 1m @18% + 1m @24% = 180k + 240k = 420k
    expect(r.cgtPence).toBe(420_000_00);
  });

  it('applies only BADR when the whole gain fits under the lifetime cap', () => {
    const r = calculateSaleWaterfall({
      enterpriseValuePence: 800_000_00,
      ownerSharePct: 100,
      acquisitionCostPence: 0,
    });
    expect(r.badrGainPence).toBe(800_000_00);
    expect(r.standardGainPence).toBe(0);
    expect(r.cgtPence).toBe(144_000_00); // 800k * 18%
    expect(r.effectiveCgtPct).toBe(18);
  });

  it('reduces BADR headroom by allowance already used', () => {
    const r = calculateSaleWaterfall({
      enterpriseValuePence: 1_000_000_00,
      ownerSharePct: 100,
      acquisitionCostPence: 0,
      badrLifetimeUsedPence: 600_000_00, // only £400k of relief left
    });
    expect(r.badrGainPence).toBe(400_000_00);
    expect(r.standardGainPence).toBe(600_000_00);
    // 400k*0.18 + 600k*0.24 = 72k + 144k = 216k
    expect(r.cgtPence).toBe(216_000_00);
  });

  it('adds freehold equity to net proceeds (untaxed here)', () => {
    const r = calculateSaleWaterfall({
      enterpriseValuePence: 500_000_00,
      ownerSharePct: 100,
      freeholdEquityPence: 300_000_00,
    });
    // gain 500k → 90k CGT; net business = 410k; + 300k freehold = 710k
    expect(r.cgtPence).toBe(90_000_00);
    expect(r.netBusinessProceedsPence).toBe(410_000_00);
    expect(r.totalNetProceedsPence).toBe(710_000_00);
  });

  it('floors negative equity (debt exceeds EV) at zero', () => {
    const r = calculateSaleWaterfall({
      enterpriseValuePence: 200_000_00,
      businessDebtPence: 500_000_00,
      ownerSharePct: 100,
    });
    expect(r.equityValuePence).toBe(0);
    expect(r.ownerEquityProceedsPence).toBe(0);
    expect(r.ownerGainPence).toBe(0);
    expect(r.cgtPence).toBe(0);
  });

  it('exposes the default UK tax constants', () => {
    expect(UK_TAX.badrRatePct).toBe(18);
    expect(UK_TAX.badrLifetimeCapPence).toBe(100_000_000);
    expect(UK_TAX.cgtHigherRatePct).toBe(24);
  });
});

describe('calculateFirePlan', () => {
  it('computes net worth, FIRE number (4% rule) and progress', () => {
    const r = calculateFirePlan({
      liquidAssetsPence: 1_000_000_00,
      liabilitiesPence: 200_000_00,
      businessNetProceedsPence: 3_000_000_00,
      targetAnnualSpendPence: 100_000_00, // £100k/yr
      withdrawalRatePct: 4,
    });
    // net worth = 1m + 3m - 200k = 3.8m
    expect(r.currentNetWorthPence).toBe(3_800_000_00);
    // FIRE number = 100k / 0.04 = 2.5m (25× spend)
    expect(r.fireNumberPence).toBe(2_500_000_00);
    expect(r.gapPence).toBe(0); // already past it
    expect(r.progressPct).toBe(152);
    // sustainable income = 4% of 3.8m = 152k
    expect(r.sustainableAnnualIncomePence).toBe(152_000_00);
    expect(r.yearsToFire).toBe(0); // already there
  });

  it('reports a gap and solves years-to-FIRE when short', () => {
    const r = calculateFirePlan({
      liquidAssetsPence: 500_000_00,
      liabilitiesPence: 0,
      businessNetProceedsPence: 0,
      targetAnnualSpendPence: 40_000_00, // FIRE number = 1m
      withdrawalRatePct: 4,
      growthRatePct: 10,
      annualSavingsPence: 0,
      horizonYears: 10,
    });
    expect(r.fireNumberPence).toBe(1_000_000_00);
    expect(r.gapPence).toBe(500_000_00);
    // 500k growing at 10%: doubles in ~8y (1.1^8 = 2.14) → year 8
    expect(r.yearsToFire).toBe(8);
  });

  it('compounds the savings annuity into the path (FV, not linear)', () => {
    const r = calculateFirePlan({
      liquidAssetsPence: 0,
      liabilitiesPence: 0,
      businessNetProceedsPence: 100_000_00,
      targetAnnualSpendPence: 40_000_00,
      growthRatePct: 10,
      annualSavingsPence: 10_000_00,
      horizonYears: 3,
    });
    // year 0 = current net worth
    expect(r.years[0].nwPence).toBe(100_000_00);
    // year 2: 100k*1.1^2 + 10k*((1.1^2-1)/0.1) = 121k + 21k = 142k
    expect(r.years[2].nwPence).toBe(142_000_00);
  });

  it('handles zero growth as a linear savings sum', () => {
    const r = calculateFirePlan({
      liquidAssetsPence: 100_000_00,
      targetAnnualSpendPence: 40_000_00,
      growthRatePct: 0,
      annualSavingsPence: 50_000_00,
      horizonYears: 4,
    });
    // year 4 = 100k + 4*50k = 300k
    expect(r.years[4].nwPence).toBe(300_000_00);
  });

  it('solves the annual savings needed to hit FIRE by the horizon', () => {
    const r = calculateFirePlan({
      liquidAssetsPence: 0,
      targetAnnualSpendPence: 40_000_00, // FIRE number = 1m
      growthRatePct: 0,
      annualSavingsPence: 0,
      horizonYears: 10,
    });
    // no growth, nothing today → need 1m/10 = 100k/yr
    expect(r.requiredAnnualSavingsPence).toBe(100_000_00);
  });

  it('floors required savings at zero when already past FIRE', () => {
    const r = calculateFirePlan({
      liquidAssetsPence: 2_000_000_00,
      targetAnnualSpendPence: 40_000_00, // FIRE number = 1m
      growthRatePct: 5,
      horizonYears: 10,
    });
    expect(r.requiredAnnualSavingsPence).toBe(0);
  });

  it('exposes FIRE defaults', () => {
    expect(FIRE_DEFAULTS.withdrawalRatePct).toBe(4);
    expect(FIRE_DEFAULTS.maxSolveYears).toBe(50);
  });
});
