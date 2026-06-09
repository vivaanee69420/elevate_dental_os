// ============================================================================
// calculateRetention — patient attrition / reactivation economics (DentaCFO
// Phase 6). Pure formula: cohorts -> retention/attrition rates + recoverable
// reactivation revenue pool. Integer pence; no DB.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { calculateRetention, RETENTION_DEFAULTS } from '../src/lib/formulas.js';

describe('calculateRetention', () => {
  it('computes retention as the active share of the known base', () => {
    const r = calculateRetention({ active: 800, lapsed: 150, dormant: 50 }, { avgPatientValuePence: 0 });
    expect(r.knownPatients).toBe(1000);
    expect(r.retentionRatePct).toBe(80);   // 800/1000
    expect(r.attritionRatePct).toBe(20);   // (150+50)/1000
  });

  it('reactivation pool = lapsed x avg value x recovery rate (dormant excluded)', () => {
    // 200 lapsed, £500 (50000p) avg, 25% win-back -> 200*50000*0.25 = 2,500,000p
    const r = calculateRetention({ active: 1000, lapsed: 200, dormant: 999 }, { avgPatientValuePence: 50000, reactivationRate: 0.25 });
    expect(r.reactivatablePatients).toBe(50);
    expect(r.reactivationValuePence).toBe(2_500_000);
    // dormant patients carry no reactivation value
  });

  it('defaults the recovery rate to RETENTION_DEFAULTS.reactivationRate', () => {
    const r = calculateRetention({ active: 0, lapsed: 100, dormant: 0 }, { avgPatientValuePence: 40000 });
    expect(r.reactivationRate).toBe(RETENTION_DEFAULTS.reactivationRate);
    expect(r.reactivationValuePence).toBe(Math.round(100 * 40000 * RETENTION_DEFAULTS.reactivationRate));
  });

  it('clamps the recovery rate into [0,1]', () => {
    expect(calculateRetention({ lapsed: 100 }, { avgPatientValuePence: 1000, reactivationRate: 5 }).reactivationRate).toBe(1);
    expect(calculateRetention({ lapsed: 100 }, { avgPatientValuePence: 1000, reactivationRate: -2 }).reactivationRate).toBe(0);
  });

  it('handles an empty patient base without dividing by zero', () => {
    const r = calculateRetention({}, {});
    expect(r.knownPatients).toBe(0);
    expect(r.retentionRatePct).toBe(0);
    expect(r.attritionRatePct).toBe(0);
    expect(r.reactivationValuePence).toBe(0);
  });

  it('rounds fractional/negative inputs to non-negative integer counts', () => {
    const r = calculateRetention({ active: 10.6, lapsed: -3, dormant: 2.2 }, { avgPatientValuePence: 100 });
    expect(r.activePatients).toBe(11);
    expect(r.lapsedPatients).toBe(0);
    expect(r.dormantPatients).toBe(2);
  });
});
