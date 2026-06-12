// ============================================================================
// Wealth service — personal Exit Plan / FIRE assembly (DentaCFO gap Phase 4).
// Covers exitPlan(): EV resolution (live valuation midpoint vs manual override
// vs no-baseline fallback), the sale waterfall feeding net cash, and the
// business-asset exclusion from the liquid FIRE pool. Repo + analytics stubbed.
// ============================================================================
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { wealthService } from '../src/services/wealth.service.js';
import { wealthRepository } from '../src/repositories/wealth.repository.js';
import { analyticsService } from '../src/services/analytics.service.js';

const ORG = 'org-1';

describe('wealthService.exitPlan', () => {
  let origGet, origVal;
  beforeEach(() => {
    origGet = wealthRepository.get;
    origVal = analyticsService.valuation;
  });
  afterEach(() => {
    wealthRepository.get = origGet;
    analyticsService.valuation = origVal;
  });

  // Helper: a minimal Exit Plan input stored in the `fire` column.
  const exitBlob = (over = {}) => ({
    incomePence: 100_000_00, incomePer: 'year', people: [{ name: 'You', share: 1 }],
    currentAge: 45, retireAge: 57, freeholds: [],
    withdrawPct: 4, returnPct: 8, currentValuePence: 0, useLiveValuation: true,
    agentPct: 0, cgtPct: 0, baseCostPence: 0, existingInvestPence: 0, targetSalePence: 0,
    ...over,
  });

  it('seeds group value today from the live valuation midpoint', async () => {
    wealthRepository.get = async () => ({
      assets: [], liabilities: [], pensions: [], properties: [],
      fire: exitBlob(),
    });
    analyticsService.valuation = async () => ({ midpoint: 3_000_000_00 });

    const r = await wealthService.exitPlan(ORG);
    expect(r.valuation.source).toBe('live');
    expect(r.valuation.currentValuePence).toBe(3_000_000_00);
    expect(r.plan.years).toBe(12);                       // 57 − 45
    // With 0% agent + 0% CGT and no existing investments, the required sale to
    // fund the pot equals the pot, so the target equals it and the gap closes.
    expect(r.plan.targetSalePence).toBe(r.plan.potNeededPence);
    expect(r.plan.gapPence).toBe(0);
    expect(r.plan.onTrack).toBe(true);
    expect(r.plan.projection).toHaveLength(31);          // year 0..30
  });

  it('uses the manual group value when useLiveValuation is off (no valuation call)', async () => {
    wealthRepository.get = async () => ({
      assets: [], liabilities: [], pensions: [], properties: [],
      fire: exitBlob({ useLiveValuation: false, currentValuePence: 800_000_00 }),
    });
    analyticsService.valuation = async () => { throw new Error('should not be called'); };

    const r = await wealthService.exitPlan(ORG);
    expect(r.valuation.source).toBe('manual');
    expect(r.valuation.currentValuePence).toBe(800_000_00);
  });

  it('falls back to the manual value when the valuation has no baseline', async () => {
    wealthRepository.get = async () => ({
      assets: [], liabilities: [], pensions: [], properties: [],
      fire: exitBlob({ currentValuePence: 500_000_00 }),
    });
    analyticsService.valuation = async () => ({ error: 'No baseline set' });

    const r = await wealthService.exitPlan(ORG);
    expect(r.valuation.source).toBe('manual');
    expect(r.valuation.currentValuePence).toBe(500_000_00);
  });

  it('seeds from the real-turnover valuation (no baseline) + passes the EBITDA margin through', async () => {
    let seenOpts = null;
    wealthRepository.get = async () => ({
      assets: [], liabilities: [], pensions: [], properties: [],
      fire: exitBlob({ ebitdaMarginPct: 20 }),
    });
    analyticsService.valuation = async (_org, opts) => {
      seenOpts = opts;
      return {
        midPoint: 6_435_000_00, midpoint: 6_435_000_00, basis: 'real-turnover',
        annualRevenuePence: 5_000_000_00, ebitdaMarginPct: 20, ebitdaPence: 1_000_000_00,
        revenueMultiple: 1.15, revenueMultipleValuePence: 5_750_000_00,
      };
    };

    const r = await wealthService.exitPlan(ORG);
    expect(seenOpts).toEqual({ marginPct: 20 });             // slider flows to valuation()
    expect(r.valuation.source).toBe('real-turnover');
    expect(r.valuation.currentValuePence).toBe(6_435_000_00);
    expect(r.valuation.detail.basis).toBe('real-turnover');
    expect(r.valuation.detail.annualRevenuePence).toBe(5_000_000_00);
    expect(r.valuation.detail.revenueMultipleValuePence).toBe(5_750_000_00);
  });

  it('seeds existing investments from liquid assets + pensions when not entered', async () => {
    wealthRepository.get = async () => ({
      assets: [
        { name: 'Practice', valuePence: 9_999_999_00, type: 'Business', liquid: true },  // excluded
        { name: 'ISA', valuePence: 200_000_00, type: 'Investments', liquid: true },
        { name: 'Home', valuePence: 800_000_00, type: 'Property', liquid: false },        // excluded
      ],
      liabilities: [], pensions: [{ name: 'SIPP', balancePence: 100_000_00 }], properties: [],
      fire: exitBlob({ existingInvestPence: 0 }),
    });
    analyticsService.valuation = async () => ({ error: 'No baseline set' });

    const r = await wealthService.exitPlan(ORG);
    expect(r.seeds.liquidAssetsPence).toBe(200_000_00);  // only liquid non-business
    expect(r.seeds.pensionPence).toBe(100_000_00);
    expect(r.seeds.existingInvestSeeded).toBe(true);
    expect(r.inputs.existingInvestPence).toBe(300_000_00); // 200k + 100k
  });

  it('returns sane empties for a never-configured org', async () => {
    wealthRepository.get = async () => null;
    analyticsService.valuation = async () => ({ error: 'No baseline set' });
    const r = await wealthService.exitPlan(ORG);
    expect(r.plan.potNeededPence).toBe(0);               // no income → no pot
    expect(r.plan.onTrack).toBe(true);
    expect(r.inputs.useLiveValuation).toBe(true);
  });
});

describe('wealthService.netWorth', () => {
  let origGet;
  beforeEach(() => { origGet = wealthRepository.get; });
  afterEach(() => { wealthRepository.get = origGet; });

  it('totals assets by type and computes book net worth', async () => {
    wealthRepository.get = async () => ({
      assets: [
        { name: 'A', valuePence: 100_000_00, type: 'Cash', growthPct: 0, liquid: true },
        { name: 'B', valuePence: 300_000_00, type: 'Cash', growthPct: 0, liquid: true },
        { name: 'C', valuePence: 200_000_00, type: 'Property', growthPct: 0, liquid: false },
      ],
      liabilities: [{ name: 'L', valuePence: 50_000_00, ratePct: 4 }],
      pensions: [], properties: [], fire: {}, sale: {},
    });
    const r = await wealthService.netWorth(ORG);
    expect(r.totalAssetsPence).toBe(600_000_00);
    expect(r.byType.Cash).toBe(400_000_00);
    expect(r.byType.Property).toBe(200_000_00);
    expect(r.totalLiabilitiesPence).toBe(50_000_00);
    expect(r.netWorthPence).toBe(550_000_00);
  });
});
