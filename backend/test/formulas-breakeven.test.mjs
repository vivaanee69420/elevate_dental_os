// backend/test/formulas-breakeven.test.mjs
import { describe, it, expect } from 'vitest';
import { calculateBreakeven } from '../src/lib/formulas.js';

// The source mockup's per-practice inputs: £31,000/mo fixed, £81k–£86k/mo
// breakeven, 20 working days. One day of trading in the window.
const MODEL = {
  fixedCostPenceMonth: 3100000,
  breakevenLowPence: 8100000,
  breakevenHighPence: 8600000,
  workingDaysPerMonth: 20,
  workingDaysInWindow: 1,
};

describe('calculateBreakeven', () => {
  it('uses fixed/breakeven as the contribution margin, not 1 - fixed/breakeven', () => {
    const r = calculateBreakeven({ ...MODEL, revenuePence: 490000 });
    // 3100000/8350000 = 0.37125748... -> 37.13%. The mockup used 62.9%, which
    // is the VARIABLE-cost ratio (1 - 0.371), not the contribution margin.
    expect(r.contributionMarginPct).toBe(37.13);
  });

  it('reconciles breakevenDay to breakevenMid / workingDays', () => {
    const r = calculateBreakeven({ ...MODEL, revenuePence: 0 });
    expect(r.breakevenMidPence).toBe(8350000);
    expect(r.fixedDayPence).toBe(155000);           // 31000/20 = £1,550
    expect(r.breakevenDayPence).toBe(417500);       // £4,175 = 8350000/20
    // This identity is the proof the margin is right: fixedDay/margin
    // = (fixed/wd)/(fixed/mid) = mid/wd. The mockup's £2,464 implied a
    // £49,280/mo breakeven, contradicting its own stated £81-86k.
    expect(r.breakevenDayPence).toBe(Math.round(r.breakevenMidPence / MODEL.workingDaysPerMonth));
  });

  it("reproduces the mockup's own table with correct outputs", () => {
    const profit = (revenuePence) => calculateBreakeven({ ...MODEL, revenuePence }).profitPence;
    expect(profit(490000)).toBe(26916);    //  Ashford      £4,900 ->   £269.16 (mockup claimed £1,532)
    expect(profit(378000)).toBe(-14665);   //  Rochester    £3,780 ->  -£146.65 (mockup claimed   £828)
    expect(profit(210000)).toBe(-77036);   //  Barnet       £2,100 ->  -£770.36
    expect(profit(170000)).toBe(-91886);   //  Bexleyheath  £1,700 ->  -£918.86
    expect(profit(322000)).toBe(-35455);   //  FTS          £3,220 ->  -£354.55 (mockup claimed   £476)
  });

  it('flips status to below where the mockup claimed above', () => {
    expect(calculateBreakeven({ ...MODEL, revenuePence: 490000 }).status).toBe('above');
    expect(calculateBreakeven({ ...MODEL, revenuePence: 378000 }).status).toBe('below');
    expect(calculateBreakeven({ ...MODEL, revenuePence: 322000 }).status).toBe('below');
  });

  it('is exactly at breakeven when revenue equals breakevenDay', () => {
    const r = calculateBreakeven({ ...MODEL, revenuePence: 417500 });
    expect(r.profitPence).toBe(0);
    expect(r.status).toBe('above'); // >= 0 counts as above
  });

  it('scales fixed cost by the days actually traded', () => {
    const r = calculateBreakeven({ ...MODEL, revenuePence: 4900000, workingDaysInWindow: 10 });
    expect(r.fixedPence).toBe(1550000);              // 155000 x 10
    expect(r.profitPence).toBe(1819162 - 1550000);   // contribution - fixed
  });

  it('returns not_set with null money rather than a phantom £0 loss', () => {
    for (const bad of [
      { fixedCostPenceMonth: 0 },
      { breakevenLowPence: 0, breakevenHighPence: 0 },
      { workingDaysPerMonth: 0 },
    ]) {
      const r = calculateBreakeven({ ...MODEL, revenuePence: 490000, ...bad });
      expect(r.status).toBe('not_set');
      expect(r.profitPence).toBeNull();
      expect(r.contributionMarginPct).toBeNull();
      expect(r.breakevenDayPence).toBeNull();
    }
  });

  it('rejects a breakeven below fixed cost as nonsense', () => {
    // margin = fixed/mid would exceed 1: revenue would have to cover more than
    // 100% contribution. That is a bad input, not a very profitable practice.
    const r = calculateBreakeven({
      ...MODEL, revenuePence: 490000,
      fixedCostPenceMonth: 9000000, breakevenLowPence: 8100000, breakevenHighPence: 8600000,
    });
    expect(r.status).toBe('not_set');
    expect(r.profitPence).toBeNull();
  });

  it('defaults to zeros without throwing when called with no args', () => {
    expect(calculateBreakeven().status).toBe('not_set');
  });
});
