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

  it('uses the live valuation midpoint and excludes business assets from the liquid pool', async () => {
    wealthRepository.get = async () => ({
      assets: [
        { name: 'Practice equity', valuePence: 9_999_999_00, type: 'Business', growthPct: 0, liquid: true },
        { name: 'ISA', valuePence: 200_000_00, type: 'Investments', growthPct: 0, liquid: true },
        { name: 'Home', valuePence: 800_000_00, type: 'Property', growthPct: 0, liquid: false },
      ],
      liabilities: [{ name: 'Mortgage', valuePence: 300_000_00, ratePct: 4 }],
      pensions: [], properties: [],
      fire: { targetAnnualSpendPence: 100_000_00, withdrawalRatePct: 4, growthRatePct: 7, annualSavingsPence: 0, horizonYears: 10 },
      sale: { ownerSharePct: 100, businessDebtPence: 0, freeholdEquityPence: 0, acquisitionCostPence: 0, badrLifetimeUsedPence: 0, useLiveValuation: true, enterpriseValuePence: 0 },
    });
    analyticsService.valuation = async () => ({ midpoint: 5_000_000_00 });

    const r = await wealthService.exitPlan(ORG);
    expect(r.valuation.source).toBe('live');
    expect(r.valuation.enterpriseValuePence).toBe(5_000_000_00);
    // only the liquid, non-business asset counts (ISA £200k); home not liquid,
    // practice equity excluded as Business.
    expect(r.inputs.liquidAssetsPence).toBe(200_000_00);
    // EV £5m, gain £5m → CGT 1m@18% + 4m@24% = 180k + 960k = 1,140k; net 3.86m
    expect(r.waterfall.cgtPence).toBe(1_140_000_00);
    expect(r.waterfall.totalNetProceedsPence).toBe(3_860_000_00);
    // net worth = liquid 200k + net proceeds 3.86m - liabilities 300k = 3.76m
    expect(r.fire.currentNetWorthPence).toBe(3_760_000_00);
    // FIRE number = 100k / 4% = 2.5m
    expect(r.fire.fireNumberPence).toBe(2_500_000_00);
  });

  it('falls back to the manual EV when useLiveValuation is off', async () => {
    wealthRepository.get = async () => ({
      assets: [], liabilities: [], pensions: [], properties: [],
      fire: { targetAnnualSpendPence: 40_000_00, withdrawalRatePct: 4, growthRatePct: 5, annualSavingsPence: 0, horizonYears: 10 },
      sale: { ownerSharePct: 100, businessDebtPence: 0, freeholdEquityPence: 0, acquisitionCostPence: 0, badrLifetimeUsedPence: 0, useLiveValuation: false, enterpriseValuePence: 800_000_00 },
    });
    analyticsService.valuation = async () => { throw new Error('should not be called'); };

    const r = await wealthService.exitPlan(ORG);
    expect(r.valuation.source).toBe('manual');
    expect(r.valuation.enterpriseValuePence).toBe(800_000_00);
    expect(r.waterfall.cgtPence).toBe(144_000_00); // 800k * 18% (under BADR cap)
  });

  it('falls back to manual EV when the valuation has no baseline', async () => {
    wealthRepository.get = async () => ({
      assets: [], liabilities: [], pensions: [], properties: [],
      fire: { targetAnnualSpendPence: 40_000_00, withdrawalRatePct: 4, growthRatePct: 5, annualSavingsPence: 0, horizonYears: 10 },
      sale: { ownerSharePct: 100, businessDebtPence: 0, freeholdEquityPence: 0, acquisitionCostPence: 0, badrLifetimeUsedPence: 0, useLiveValuation: true, enterpriseValuePence: 500_000_00 },
    });
    analyticsService.valuation = async () => ({ error: 'No baseline set' });

    const r = await wealthService.exitPlan(ORG);
    expect(r.valuation.source).toBe('manual');
    expect(r.valuation.enterpriseValuePence).toBe(500_000_00);
  });

  it('returns sane empties for a never-configured org', async () => {
    wealthRepository.get = async () => null;
    analyticsService.valuation = async () => ({ error: 'No baseline set' });
    const r = await wealthService.exitPlan(ORG);
    expect(r.fire.currentNetWorthPence).toBe(0);
    expect(r.fire.fireNumberPence).toBe(0);
    expect(r.inputs.sale.useLiveValuation).toBe(true);
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
