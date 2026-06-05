// ============================================================================
// Profit Benchmarking — calculateProfitBenchmark (Intelligence OS — CoA→P&L).
// Actual cost/profit ratios vs the UK dental group constants:
//   Dentist 45% · Staff 18% · Lab+Material 15% · Other Fixed 12% · Profit 10%.
// Integer pence in; pure. Mirrors the prototype benchPanel verdict logic.
// ============================================================================

import { describe, it, expect } from 'vitest';
import { calculateProfitBenchmark, PROFIT_BENCHMARKS } from '../src/lib/formulas.js';

// A £1,000,000 P&L sitting exactly on every benchmark.
const onBenchmark = {
  revenue: 100_000_000,
  costs: {
    associates: 45_000_000, // 45% dentist
    staff: 18_000_000,      // 18% staff
    lab: 10_000_000,
    materials: 5_000_000,   // 15% lab+material
    property: 4_000_000,
    marketing: 3_000_000,
    other: 5_000_000,       // 12% other fixed
  },
  netProfit: 10_000_000,    // 10% profit
};

describe('PROFIT_BENCHMARKS — documented group constants', () => {
  it('are 45/18/15/12/10', () => {
    expect(PROFIT_BENCHMARKS).toEqual({ dentist: 45, staff: 18, labMaterial: 15, otherFixed: 12, profit: 10 });
  });
});

describe('calculateProfitBenchmark — five categories', () => {
  it('emits a row per category mapped from calculatePL cost lines', () => {
    const r = calculateProfitBenchmark(onBenchmark);
    expect(r.rows.map((x) => x.key)).toEqual(['dentist', 'staff', 'labMaterial', 'otherFixed', 'profit']);
  });

  it('on-benchmark P&L: every row neutral, zero variance, no overspend', () => {
    const r = calculateProfitBenchmark(onBenchmark);
    for (const row of r.rows) {
      expect(row.variancePts).toBe(0);
      expect(row.severity).toBe('neutral');
      expect(row.verdict).toBe('On benchmark');
    }
    expect(r.overspendPence).toBe(0);
  });

  it('benchmark £ = revenue * benchmark% (lab+material combines two buckets)', () => {
    const r = calculateProfitBenchmark(onBenchmark);
    const lab = r.rows.find((x) => x.key === 'labMaterial');
    expect(lab.benchmarkPct).toBe(15);
    expect(lab.benchmarkPence).toBe(15_000_000);
    expect(lab.actualPence).toBe(15_000_000); // lab 10m + materials 5m
    expect(lab.actualPct).toBe(15);
  });

  it('overspending cost line → bad + Overspending; recoverable totalled', () => {
    const input = {
      ...onBenchmark,
      costs: { ...onBenchmark.costs, staff: 22_000_000 }, // 22% — 4pts over
      netProfit: 6_000_000, // 6% — 4pts under floor
    };
    const r = calculateProfitBenchmark(input);
    const staff = r.rows.find((x) => x.key === 'staff');
    expect(staff.variancePts).toBe(4);
    expect(staff.severity).toBe('bad');
    expect(staff.verdict).toBe('Overspending');

    const profit = r.rows.find((x) => x.key === 'profit');
    expect(profit.variancePts).toBe(-4);
    expect(profit.severity).toBe('bad');
    expect(profit.verdict).toBe('Below target'); // profit below floor is bad

    // recoverable = cost lines above benchmark only (profit excluded)
    expect(r.overspendPence).toBe(4_000_000);
  });

  it('lean cost line (under benchmark) → good + Lean', () => {
    const input = { ...onBenchmark, costs: { ...onBenchmark.costs, staff: 14_000_000 } }; // 14% — 4 under
    const r = calculateProfitBenchmark(input);
    const staff = r.rows.find((x) => x.key === 'staff');
    expect(staff.severity).toBe('good');
    expect(staff.verdict).toBe('Lean');
    expect(r.overspendPence).toBe(0);
  });

  it('profit above floor → good + Above target', () => {
    const input = { ...onBenchmark, netProfit: 14_000_000 }; // 14% — 4 over floor
    const r = calculateProfitBenchmark(input);
    const profit = r.rows.find((x) => x.key === 'profit');
    expect(profit.severity).toBe('good');
    expect(profit.verdict).toBe('Above target');
  });

  it('neutral band: |variance| < 1pt reads as On benchmark', () => {
    const input = { ...onBenchmark, costs: { ...onBenchmark.costs, staff: 18_500_000 } }; // 18.5% — 0.5 over
    const r = calculateProfitBenchmark(input);
    const staff = r.rows.find((x) => x.key === 'staff');
    expect(staff.variancePts).toBe(0.5);
    expect(staff.severity).toBe('neutral');
    expect(staff.verdict).toBe('On benchmark');
  });

  it('honest flag: Xero folds associate pay into staff → not separable', () => {
    const folded = {
      revenue: 100_000_000,
      costs: { associates: 0, staff: 63_000_000, lab: 10_000_000, materials: 5_000_000, property: 4_000_000, marketing: 3_000_000, other: 5_000_000 },
      netProfit: 10_000_000,
    };
    const r = calculateProfitBenchmark(folded);
    expect(r.dentistStaffSeparable).toBe(false);
    // when separable, the on-benchmark case flags true
    expect(calculateProfitBenchmark(onBenchmark).dentistStaffSeparable).toBe(true);
  });

  it('zero-revenue is safe (no divide-by-zero)', () => {
    const r = calculateProfitBenchmark({ revenue: 0, costs: { staff: 0, lab: 0, materials: 0, associates: 0, property: 0, marketing: 0, other: 0 }, netProfit: 0 });
    expect(r.revenue).toBe(0);
    for (const row of r.rows) expect(row.actualPct).toBe(0);
  });
});
