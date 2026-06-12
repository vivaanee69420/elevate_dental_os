// ============================================================================
// valuationFromTurnover — real-turnover valuation seed (DentaCFO Exit Plan).
// When no manual baseline / Xero EBITDA exists, the group is valued from the
// REAL synced turnover (invoice_items TTM): EBITDA = assumed margin × turnover,
// fed through the existing calculateValuation multiples, plus a direct
// revenue-multiple cross-check. Integer pence; golden values hand-computed.
// ============================================================================

import { describe, it, expect } from 'vitest';
import { valuationFromTurnover, calculateValuation } from '../src/lib/formulas.js';

// £5,000,000 turnover, 100% private, default 18% EBITDA margin, 1.15× rev mult.
const REV = 500_000_000; // £5,000,000 in pence

describe('valuationFromTurnover — £5M private group (hand-verified golden)', () => {
  const r = valuationFromTurnover({ annualRevenuePence: REV });

  it('derives EBITDA from the default 18% margin', () => {
    expect(r.ebitdaMarginPct).toBe(18);
    expect(r.ebitdaPence).toBe(90_000_000); // £5M × 18% = £900k
  });

  it('values via the private multiple tier (matches calculateValuation)', () => {
    const direct = calculateValuation({
      annualRevenue: REV, ebitda: 90_000_000,
      nhsRevenuePct: 0, privateRevenuePct: 100,
    });
    // private tier: principal 7.3, dso 7.0 → midpoint = ebitda × 7.15
    expect(r.midPoint).toBe(direct.midPoint);
    expect(r.midPoint).toBe(90_000_000 * 7.15); // £643,500,000
  });

  it('normalises midpoint to a lowercase alias for consumers', () => {
    expect(r.midpoint).toBe(r.midPoint);
  });

  it('computes the revenue-multiple cross-check (default 1.15×)', () => {
    expect(r.revenueMultiple).toBe(1.15);
    expect(r.revenueMultipleValuePence).toBe(575_000_000); // £5M × 1.15
  });

  it('echoes the turnover it valued from', () => {
    expect(r.annualRevenuePence).toBe(REV);
  });
});

describe('valuationFromTurnover — overrides + guards', () => {
  it('honours a custom EBITDA margin', () => {
    const r = valuationFromTurnover({ annualRevenuePence: REV, ebitdaMarginPct: 25 });
    expect(r.ebitdaPence).toBe(125_000_000); // £5M × 25%
  });

  it('honours a custom revenue multiple', () => {
    const r = valuationFromTurnover({ annualRevenuePence: REV, revenueMultiple: 1.3 });
    expect(r.revenueMultipleValuePence).toBe(650_000_000);
  });

  it('drops to the NHS multiple tier on a low private share', () => {
    const priv = valuationFromTurnover({ annualRevenuePence: REV, privateRevenuePct: 100 });
    const nhs = valuationFromTurnover({ annualRevenuePence: REV, privateRevenuePct: 10 });
    expect(nhs.midPoint).toBeLessThan(priv.midPoint); // NHS multiples are lower
  });

  it('clamps a negative margin to zero and a >100 margin to 100', () => {
    expect(valuationFromTurnover({ annualRevenuePence: REV, ebitdaMarginPct: -5 }).ebitdaPence).toBe(0);
    expect(valuationFromTurnover({ annualRevenuePence: REV, ebitdaMarginPct: 150 }).ebitdaPence).toBe(REV);
  });

  it('returns zeros for zero/garbage turnover, never NaN', () => {
    const r = valuationFromTurnover({ annualRevenuePence: 0 });
    expect(r.midPoint).toBe(0);
    expect(r.ebitdaPence).toBe(0);
    expect(r.revenueMultipleValuePence).toBe(0);
    expect(Number.isNaN(r.midPoint)).toBe(false);
  });
});
