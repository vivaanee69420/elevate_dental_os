// ============================================================================
// Group Valuation engine — computeGroupValuation / valueUpliftLevers /
// planExitTrajectory (Intelligence OS — Value & Growth). Integer pence; golden
// values hand-computed. These mirror the previously-client-side model exactly,
// so moving the compute server-side must not change any output.
// ============================================================================

import { describe, it, expect } from 'vitest';
import {
  computeGroupValuation,
  valuationGrowthAdjust,
  valueUpliftLevers,
  planExitTrajectory,
  calculateValuation,
} from '../src/lib/formulas.js';

const svc = (await import('../src/services/analytics.service.js')).analyticsService;
const { valuationStateSchema, valuationExitPlanSchema } = await import('../src/models/analytics.model.js');

// A mixed-practice, South-East group — £400k reported EBITDA, £30k add-backs,
// £120k notional principal salary, mixed multiples (3.3/7.0/6.175), +5% region.
const STATE = {
  reportedEbitdaPence: 40_000_000,
  addBacksPence: 3_000_000,
  principalSalaryPence: 12_000_000,
  principalMultiple: 3.3,
  associateMultiple: 7.0,
  dsoMultiple: 6.175, // 6.5 * 0.95 bolt-on factor
  regionFactor: 1.05,
  growthRatePct: 10,
};

describe('computeGroupValuation — mixed SE group (hand-verified golden)', () => {
  const r = computeGroupValuation(STATE);

  it('EBITDA build-up (ANP vs adjusted)', () => {
    expect(r.principalNetProfit).toBe(43_000_000); // reported + add-backs
    expect(r.associateEbitda).toBe(55_000_000); // + principal salary
    expect(r.reportedEbitda).toBe(40_000_000);
  });

  it('growth adjust is neutral at 10% YoY', () => {
    expect(r.growthAdjust).toBe(1);
    expect(valuationGrowthAdjust(10)).toBe(1);
  });

  it('three buyer valuations + midpoint + strategic', () => {
    // principal = 43,000,000 * 3.3 * 1.05 = 148,995,000
    expect(r.principalValuation).toBe(148_995_000);
    // associate = 55,000,000 * 7.0 * 1.05 = 404,250,000
    expect(r.associateValuation).toBe(404_250_000);
    // dso = 55,000,000 * 6.175 * 1.05 * 1.0 = 356,606,250
    expect(r.dsoValuation).toBe(356_606_250);
    // midpoint = (associate + principal) / 2
    expect(r.midpoint).toBe(276_622_500);
    // strategic = dso * 1.1
    expect(r.strategic).toBe(392_266_875);
  });

  it('growth premium lifts DSO above 10%, penalty below', () => {
    expect(valuationGrowthAdjust(15)).toBe(1.1); // +1pt per 5pts above 10
    expect(valuationGrowthAdjust(20)).toBe(1.2);
    expect(valuationGrowthAdjust(60)).toBe(1.2); // capped +20%
    expect(valuationGrowthAdjust(0)).toBe(0.85); // floored at -15%
    expect(valuationGrowthAdjust(-100)).toBe(0.85); // still floored at -15%
  });
});

describe('valueUpliftLevers — ranked pence impacts', () => {
  const r = computeGroupValuation(STATE);
  const levers = valueUpliftLevers({
    result: r,
    principalMultiple: STATE.principalMultiple,
    associateMultiple: STATE.associateMultiple,
    dsoMultiple: STATE.dsoMultiple,
  });

  it('returns six levers sorted by impact descending', () => {
    expect(levers).toHaveLength(6);
    for (let i = 1; i < levers.length; i++) {
      expect(levers[i - 1].impactPence).toBeGreaterThanOrEqual(levers[i].impactPence);
    }
  });

  it('private-mix lever = 0.5 x adjusted EBITDA', () => {
    const lever = levers.find((l) => l.key === 'private_mix');
    expect(lever.impactPence).toBe(27_500_000); // 0.5 * 55,000,000
  });

  it('second-site lever = 15% of DSO valuation', () => {
    const lever = levers.find((l) => l.key === 'second_site');
    expect(lever.impactPence).toBe(53_490_938); // 356,606,250 * 0.15 (rounded)
  });
});

describe('planExitTrajectory — Sale Planner path', () => {
  const r = computeGroupValuation(STATE);
  const plan = planExitTrajectory({
    base: { ttmRevenuePence: 80_000_000, reportedEbitdaPence: 40_000_000 },
    plan: {
      targetValuePence: 1_000_000_000, // £10M
      targetYears: 5,
      futureEbitdaPence: 100_000_000, // £1M
      futureRevenuePence: 250_000_000, // £2.5M
      futureMultiple: 8,
      futureBuyerType: 'associate',
      addedSites: 5,
      siteCount: 5,
    },
    baselinePence: r.midpoint,
    principalSalaryPence: 12_000_000,
  });

  it('projected = future EBITDA x multiple (associate, no premium)', () => {
    expect(plan.projectedPence).toBe(800_000_000); // 100,000,000 * 8
  });

  it('EBITDA needed = target / multiple', () => {
    expect(plan.ebitdaNeededPence).toBe(125_000_000); // 1,000,000,000 / 8
  });

  it('future + current margins', () => {
    expect(plan.ebitdaMarginPct).toBe(40); // 100/250
    expect(plan.currentEbitdaMarginPct).toBe(50); // 40/80
  });

  it('year-by-year interpolation, target year included', () => {
    expect(plan.years).toHaveLength(6); // Y0..Y5
    expect(plan.years[0].revPence).toBe(80_000_000); // now
    expect(plan.years[5].revPence).toBe(250_000_000); // exit
    expect(plan.years[5].ebitdaPence).toBe(100_000_000);
    expect(plan.years[5].sites).toBe(10);
  });

  it('gap floors at zero when baseline already exceeds target', () => {
    const p = planExitTrajectory({
      base: { ttmRevenuePence: 80_000_000, reportedEbitdaPence: 40_000_000 },
      plan: { targetValuePence: 1_000_000, targetYears: 5, futureEbitdaPence: 1, futureRevenuePence: 1, futureMultiple: 1, futureBuyerType: 'associate', addedSites: 0, siteCount: 5 },
      baselinePence: 50_000_000,
    });
    expect(p.gapPence).toBe(0);
  });

  it('DSO buyer gets the 10% group premium at 10+ sites', () => {
    const p = planExitTrajectory({
      base: { ttmRevenuePence: 80_000_000, reportedEbitdaPence: 40_000_000 },
      plan: { targetValuePence: 1_000_000_000, targetYears: 5, futureEbitdaPence: 100_000_000, futureRevenuePence: 250_000_000, futureMultiple: 8, futureBuyerType: 'dso', addedSites: 5, siteCount: 5 },
      baselinePence: r.midpoint,
    });
    expect(p.projectedPence).toBe(880_000_000); // 100,000,000 * 8 * 1.1
  });

  it('principal buyer subtracts the notional salary first', () => {
    const p = planExitTrajectory({
      base: { ttmRevenuePence: 80_000_000, reportedEbitdaPence: 40_000_000 },
      plan: { targetValuePence: 1_000_000_000, targetYears: 5, futureEbitdaPence: 100_000_000, futureRevenuePence: 250_000_000, futureMultiple: 3, futureBuyerType: 'principal', addedSites: 0, siteCount: 5 },
      baselinePence: r.midpoint,
      principalSalaryPence: 12_000_000,
    });
    expect(p.projectedPence).toBe(264_000_000); // (100,000,000 - 12,000,000) * 3
  });
});

describe('legacy calculateValuation is untouched (no silent regression)', () => {
  it('still produces the simple 3-buyer result from §2', () => {
    const legacy = calculateValuation({
      annualRevenue: 80_000_000,
      ebitda: 40_000_000,
      nhsRevenuePct: 50,
      privateRevenuePct: 50,
    });
    // mixed: principal 7.0, associate 3.3, dso 6.5
    expect(legacy.principalLed).toBe(280_000_000); // 40,000,000 * 7.0
    expect(legacy.dso).toBe(260_000_000); // 40,000,000 * 6.5
  });
});

describe('valuation schemas validate + coerce', () => {
  it('valuationStateSchema accepts a full state', () => {
    const parsed = valuationStateSchema.parse(STATE);
    expect(parsed.regionFactor).toBe(1.05);
  });

  it('service computeValuation returns result + sorted levers', () => {
    const out = svc.computeValuation(valuationStateSchema.parse(STATE));
    expect(out.result.midpoint).toBe(276_622_500);
    expect(out.levers).toHaveLength(6);
  });

  it('valuationExitPlanSchema + service exit plan round-trips', () => {
    const body = valuationExitPlanSchema.parse({
      base: { ttmRevenuePence: 80_000_000, reportedEbitdaPence: 40_000_000 },
      baselinePence: 276_622_500,
      principalSalaryPence: 12_000_000,
      plan: {
        targetValuePence: 1_000_000_000, targetYears: 5,
        futureEbitdaPence: 100_000_000, futureRevenuePence: 250_000_000,
        futureMultiple: 8, futureBuyerType: 'associate', addedSites: 5, siteCount: 5,
      },
    });
    const out = svc.computeValuationExitPlan(body);
    expect(out.projectedPence).toBe(800_000_000);
    expect(out.years).toHaveLength(6);
  });
});
