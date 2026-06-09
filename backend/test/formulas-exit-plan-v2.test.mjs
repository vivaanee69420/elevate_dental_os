// Canonical Exit Plan (faithful port of the GM demo `exitCalc`) — DentaCFO
// Phase 4 rebuild. Covers the UK income-tax gross-up, the people-split tax
// saving, freehold-rent pot reduction, the reverse-solved required sale, and
// the 30-year drawdown projection. Money is INTEGER PENCE.
import { describe, it, expect } from 'vitest';
import { ukIncomeTaxPence, grossUpPence, calculateExitPlan } from '../src/lib/formulas.js';

describe('ukIncomeTaxPence (2025/26 bands)', () => {
  it('no tax up to the personal allowance', () => {
    expect(ukIncomeTaxPence(12_570_00)).toBe(0);
  });
  it('basic rate at the higher-rate threshold', () => {
    // (50,270 − 12,570) × 20% = £7,540
    expect(ukIncomeTaxPence(50_270_00)).toBe(7_540_00);
  });
  it('tapers the personal allowance away above £100k', () => {
    // PA fully tapered by £125,140; bands: 50,270@20 + 74,870@40 + 74,860@45
    // = 10,054 + 29,948 + 33,687 = £73,689
    expect(ukIncomeTaxPence(200_000_00)).toBe(73_689_00);
  });
});

describe('grossUpPence', () => {
  it('round-trips: gross − tax ≈ requested net', () => {
    const net = 100_000_00;
    const gross = grossUpPence(net);
    expect(gross).toBeGreaterThan(net);
    // within a few pence of the bisection tolerance
    expect(Math.abs((gross - ukIncomeTaxPence(gross)) - net)).toBeLessThan(50);
  });
  it('is zero for zero/negative net', () => {
    expect(grossUpPence(0)).toBe(0);
    expect(grossUpPence(-100)).toBe(0);
  });
});

const base = (over = {}) => ({
  incomePence: 100_000_00, people: [{ name: 'You', share: 1 }],
  currentAge: 45, retireAge: 57, freeholds: [],
  withdrawPct: 4, returnPct: 8, currentValuePence: 2_000_000_00,
  agentPct: 0, cgtPct: 0, baseCostPence: 0, existingInvestPence: 0,
  targetSalePence: 0, baseYear: 2026, ...over,
});

describe('calculateExitPlan', () => {
  it('computes the runway and exit year from ages', () => {
    const c = calculateExitPlan(base());
    expect(c.years).toBe(12);
    expect(c.exitYear).toBe(2038); // 2026 + 12
    expect(c.projection).toHaveLength(31);
  });

  it('splitting income across people cuts the gross required (tax saving)', () => {
    const single = calculateExitPlan(base({ people: [{ name: 'You', share: 1 }] }));
    const couple = calculateExitPlan(base({ people: [{ name: 'You', share: 1 }, { name: 'Partner', share: 1 }] }));
    expect(single.taxSavingPence).toBe(0);                       // nothing to split
    expect(couple.grossRequiredPence).toBeLessThan(single.grossRequiredPence);
    expect(couple.taxSavingPence).toBeGreaterThan(0);
  });

  it('freehold rent shrinks the pot needed', () => {
    const noRent = calculateExitPlan(base());
    const withRent = calculateExitPlan(base({ freeholds: [{ name: 'FH', valuePence: 2_000_000_00, rentPence: 30_000_00 }] }));
    expect(withRent.totalRentPence).toBe(30_000_00);
    expect(withRent.portfolioGrossPence).toBe(noRent.grossRequiredPence - 30_000_00);
    expect(withRent.potNeededPence).toBeLessThan(noRent.potNeededPence);
  });

  it('reverse-solves the required sale and closes the gap with zero fees', () => {
    const c = calculateExitPlan(base());
    // 0% agent + 0% CGT, no existing investments → required sale == pot needed
    expect(c.requiredSalePence).toBe(c.potNeededPence);
    expect(c.targetSalePence).toBe(c.requiredSalePence);        // targetSale 0 → defaults
    expect(c.gapPence).toBe(0);
    expect(c.onTrack).toBe(true);
  });

  it('applies agent fee + CGT in the forward waterfall', () => {
    const c = calculateExitPlan(base({ targetSalePence: 1_000_000_00, agentPct: 1.5, cgtPct: 18, baseCostPence: 0 }));
    expect(c.agentFeePence).toBe(15_000_00);                    // 1.5% of £1m
    expect(c.cgtPence).toBe(180_000_00);                        // 18% of £1m gain
    expect(c.netProceedsPence).toBe(1_000_000_00 - 15_000_00 - 180_000_00);
    expect(c.investablePence).toBe(c.netProceedsPence);         // no existing investments
  });

  it('the 30-year pot compounds upward when return > withdrawal', () => {
    const c = calculateExitPlan(base({ targetSalePence: 5_000_000_00, returnPct: 8, withdrawPct: 4 }));
    const first = c.projection[0], last = c.projection[30];
    expect(last.endPence).toBeGreaterThan(first.startPence);    // pot grows
    expect(last.incomePence).toBeGreaterThan(first.incomePence); // income rises for life
  });

  it('reports a shortfall when the target sale underfunds the pot', () => {
    const c = calculateExitPlan(base({ targetSalePence: 100_000_00 }));
    expect(c.gapPence).toBeGreaterThan(0);
    expect(c.onTrack).toBe(false);
  });
});
