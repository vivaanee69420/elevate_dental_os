// ============================================================================
// Chair economics formulas — calculateChairStats / calculateOcpspd /
// profitPerChairHour / chairRecovery. Integer pence; golden values computed
// by hand from the documented CHAIR_CONFIG (openHrs 8, weeksYr 46, daysWk 5 ->
// 230 working days, benchOcc 88%, benchRev £300/hr). Guards: 0 chairs, 0 days.
// ============================================================================

import { describe, it, expect } from 'vitest';
import {
  CHAIR_CONFIG,
  workDaysYr,
  calculateChairStats,
  calculateOcpspd,
  profitPerChairHour,
  chairRecovery,
} from '../src/lib/formulas.js';

describe('workDaysYr', () => {
  it('defaults to 46*5 = 230', () => {
    expect(workDaysYr()).toBe(230);
    expect(workDaysYr({ weeksYr: 48, daysWk: 5 })).toBe(240);
  });
});

describe('calculateChairStats', () => {
  // 6 chairs * 8h * 230d = 11,040 capacity hrs/yr. util 84% -> 9273.6 booked.
  // Revenue chosen so 231,840,000p / 9273.6h = exactly 25,000p (£250/hr).
  const s = calculateChairStats({ chairs: 6, utilPct: 84, annualRevenuePence: 231_840_000 });

  it('capacity, booked, empty hours', () => {
    expect(s.capHrsYr).toBe(11040);
    expect(s.bookedHrsYr).toBe(9274); // 9273.6 rounded
    expect(s.emptyHrsYr).toBe(1766);  // 11040 - 9273.6 = 1766.4 -> 1766
  });

  it('rev per booked hour = annual revenue / booked hrs (pence)', () => {
    // 231,840,000p / 9273.6h = 25,000p (£250/hr)
    expect(s.revPerBookedHrPence).toBe(25000);
  });

  it('cost of empty chairs = empty hrs * bench £300/hr', () => {
    // 1766.4h * 30000p = 52,992,000p
    expect(s.lostPotentialYrPence).toBe(52_992_000);
  });

  it('recoverable to 88% benchmark, valued at own yield', () => {
    // (88-84)% of 11040 = 441.6 hrs; * 25000p/hr = 11,040,000p
    expect(s.recoverableToBenchHrsYr).toBe(442);
    expect(s.recoverRevYrPence).toBe(11_040_000);
  });

  it('occupancy variance vs 88% benchmark', () => {
    expect(s.occVariancePct).toBe(-4);
    expect(s.surgeryDaysYr).toBe(1380); // 6 * 230
  });

  it('0 chairs -> no division by zero', () => {
    const z = calculateChairStats({ chairs: 0, utilPct: 80, annualRevenuePence: 1_000_000 });
    expect(z.capHrsYr).toBe(0);
    expect(z.revPerBookedHrPence).toBe(0);
    expect(z.lostPotentialYrPence).toBe(0);
  });

  it('util at/above benchmark -> recoverable clamps to 0', () => {
    const hot = calculateChairStats({ chairs: 4, utilPct: 92, annualRevenuePence: 5_000_000 });
    expect(hot.recoverableToBenchHrsYr).toBe(0);
    expect(hot.recoverRevYrPence).toBe(0);
  });
});

describe('calculateOcpspd', () => {
  it('per day = annual opex / surgery-days; per hour = perDay / openHrs', () => {
    // opex £600k = 60,000,000p over 1380 surgery-days = 43,478p/day; /8 = 5435p/hr
    const o = calculateOcpspd({ annualOpexPence: 60_000_000, surgeryDaysYr: 1380 });
    expect(o.perDayPence).toBe(43478);
    expect(o.perHrPence).toBe(5435); // 43478/8 = 5434.75 -> 5435
  });
  it('0 surgery-days -> 0, no NaN', () => {
    const o = calculateOcpspd({ annualOpexPence: 1_000_000, surgeryDaysYr: 0 });
    expect(o.perDayPence).toBe(0);
    expect(o.perHrPence).toBe(0);
  });
});

describe('profitPerChairHour', () => {
  const r = profitPerChairHour({
    treatments: [
      { key: 'implant', label: 'Implant', minutes: 90, units: 10, revenuePence: 2_050_000, profitPence: 900_000 },
      { key: 'hygiene', label: 'Hygiene', minutes: 40, units: 30, revenuePence: 276_000, profitPence: 120_000 },
      { key: 'none', label: 'None', minutes: 60, units: 0, revenuePence: 0, profitPence: 0 }, // filtered
    ],
  });

  it('filters zero-unit rows and ranks by profit/hr desc', () => {
    expect(r.rows.map((x) => x.key)).toEqual(['implant', 'hygiene']);
    // implant: 90*10/60 = 15h; 900000/15 = 60000p/hr. hygiene: 40*30/60=20h; 120000/20=6000p/hr.
    expect(r.rows[0].profitPerHrPence).toBe(60000);
    expect(r.rows[1].profitPerHrPence).toBe(6000);
  });

  it('blended profit/hr over all chair-hours', () => {
    // total profit 1,020,000p over 35h = 29,142.8 -> 29143
    expect(r.totalChairHrs).toBe(35);
    expect(r.blendedProfitPerHrPence).toBe(29143);
  });

  it('empty input -> zeros, no NaN', () => {
    const e = profitPerChairHour({ treatments: [] });
    expect(e.rows).toEqual([]);
    expect(e.blendedProfitPerHrPence).toBe(0);
  });
});

describe('chairRecovery', () => {
  it('hours + revenue unlocked at own yield; new occupancy clamped', () => {
    // 10 pts of 11040 cap = 1104h; * 25284p = 27,913,... ; occ 84+10=94
    const rec = chairRecovery({ capHrsYr: 11040, upliftPctPoints: 10, revPerBookedHrPence: 25284, currentOccupancyPct: 84 });
    expect(rec.recoveryHrsYr).toBe(1104);
    expect(rec.revenueUnlockedPence).toBe(Math.round(1104 * 25284));
    expect(rec.newOccupancyPct).toBe(94);
  });
  it('uplift past 100% clamps occupancy', () => {
    const rec = chairRecovery({ capHrsYr: 1000, upliftPctPoints: 30, revPerBookedHrPence: 100, currentOccupancyPct: 85 });
    expect(rec.newOccupancyPct).toBe(100);
  });
});
