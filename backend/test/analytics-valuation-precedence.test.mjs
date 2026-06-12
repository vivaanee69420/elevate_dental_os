// ============================================================================
// analyticsService.valuation — seeding precedence:
//   (1) manual business_health baseline  → basis 'baseline'
//   (2) no baseline, real synced turnover → basis 'real-turnover'
//   (3) no baseline, no turnover          → { error: 'No baseline set' }
// Repo stubbed. Integer pence.
// ============================================================================
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { analyticsService } from '../src/services/analytics.service.js';
import { analyticsRepository } from '../src/repositories/analytics.repository.js';

const ORG = 'org-1';

describe('analyticsService.valuation precedence', () => {
  let origBaseline, origTurnover;
  beforeEach(() => {
    origBaseline = analyticsRepository.baselineSingle;
    origTurnover = analyticsRepository.turnoverTTM;
  });
  afterEach(() => {
    analyticsRepository.baselineSingle = origBaseline;
    analyticsRepository.turnoverTTM = origTurnover;
  });

  it('uses the manual baseline when revenue + profit are set', async () => {
    analyticsRepository.baselineSingle = async () => ({
      baseline: { revenue: 1_000_000, profit: 200_000, private_pct: 80 },
    });
    analyticsRepository.turnoverTTM = async () => { throw new Error('should not be called'); };

    const v = await analyticsService.valuation(ORG);
    expect(v.basis).toBe('baseline');
    expect(v.midpoint).toBe(v.midPoint);                 // lowercase alias present
    expect(v.midpoint).toBeGreaterThan(0);
    expect(v.error).toBeUndefined();
  });

  it('seeds from real turnover when there is no baseline', async () => {
    analyticsRepository.baselineSingle = async () => ({ baseline: {} });
    analyticsRepository.turnoverTTM = async () => ({
      totalPence: 500_000_000, privatePence: 500_000_000, // £5M, 100% private
    });

    const v = await analyticsService.valuation(ORG, { marginPct: 18 });
    expect(v.basis).toBe('real-turnover');
    expect(v.annualRevenuePence).toBe(500_000_000);
    expect(v.ebitdaPence).toBe(90_000_000);              // £5M × 18%
    expect(v.midPoint).toBe(90_000_000 * 7.15);          // private tier midpoint
    expect(v.revenueMultipleValuePence).toBe(575_000_000);
  });

  it('returns "No baseline set" when there is neither baseline nor turnover', async () => {
    analyticsRepository.baselineSingle = async () => ({ baseline: {} });
    analyticsRepository.turnoverTTM = async () => ({ totalPence: 0, privatePence: 0 });

    const v = await analyticsService.valuation(ORG);
    expect(v.error).toBe('No baseline set');
  });

  it('survives a turnover repo error by yielding "No baseline set" (never throws)', async () => {
    analyticsRepository.baselineSingle = async () => null;
    analyticsRepository.turnoverTTM = async () => { throw new Error('db down'); };

    const v = await analyticsService.valuation(ORG);
    expect(v.error).toBe('No baseline set');
  });
});
