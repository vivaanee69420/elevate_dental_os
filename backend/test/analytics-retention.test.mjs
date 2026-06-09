// ============================================================================
// Attrition & Retention — analyticsService.retention (DentaCFO gap Phase 6).
// Covers per-practice cohort + avg-value join, the reactivation revenue pool,
// org rollup + RAG, the academy/lab not-applicable guard, the unlinked-appts
// data-wall flag, and the empty-org path. Repository fully stubbed (no DB).
// ============================================================================
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { analyticsService } from '../src/services/analytics.service.js';
import { analyticsRepository } from '../src/repositories/analytics.repository.js';

const ORG = 'org-1';
const NOW = () => new Date('2026-06-09T12:00:00Z');

describe('analyticsService.retention', () => {
  let orig;
  beforeEach(() => {
    orig = {
      practicesFull: analyticsRepository.practicesFull,
      patientRetentionByPractice: analyticsRepository.patientRetentionByPractice,
      settledRevenueByPractice: analyticsRepository.settledRevenueByPractice,
      entitiesByKind: analyticsRepository.entitiesByKind,
    };
  });
  afterEach(() => Object.assign(analyticsRepository, orig));

  function stub({ practices = [], ret = [], rev = [] }) {
    analyticsRepository.practicesFull = async () => practices;
    analyticsRepository.patientRetentionByPractice = async () => ret;
    analyticsRepository.settledRevenueByPractice = async () => rev;
  }

  it('joins cohorts to revenue and computes the reactivation pool', async () => {
    stub({
      practices: [{ id: 'p1', name: 'Central' }],
      // 800 active, 200 lapsed, 100 dormant
      ret: [{ practice_id: 'p1', active_patients: 800, lapsed_patients: 200, dormant_patients: 100, total_patients: 1100, unlinked_appts: 0 }],
      // £400,000 trailing-12mo settled -> avg value = 40000000p/800 = 50000p (£500)
      rev: [{ practice_id: 'p1', pence: 40_000_000 }],
    });
    const r = await analyticsService.retention(ORG, { scope: 'all', now: NOW });
    expect(r.applicable).toBe(true);
    expect(r.hasData).toBe(true);
    const p = r.practices[0];
    expect(p.avgPatientValuePence).toBe(50_000);
    expect(p.retentionRatePct).toBeCloseTo(72.7, 1); // 800/1100
    // default 0.25 win-back: 200 * 50000 * 0.25 = 2,500,000p
    expect(p.reactivationValuePence).toBe(2_500_000);
    expect(r.org.reactivationValuePence).toBe(2_500_000);
  });

  it('honours a custom reactivation rate', async () => {
    stub({
      practices: [{ id: 'p1', name: 'A' }],
      ret: [{ practice_id: 'p1', active_patients: 100, lapsed_patients: 100, dormant_patients: 0, total_patients: 200, unlinked_appts: 0 }],
      rev: [{ practice_id: 'p1', pence: 10_000_000 }], // avg = 100000p
    });
    const r = await analyticsService.retention(ORG, { scope: 'all', reactivationRate: 0.5, now: NOW });
    expect(r.reactivationRate).toBe(0.5);
    // 100 * 100000 * 0.5 = 5,000,000p
    expect(r.practices[0].reactivationValuePence).toBe(5_000_000);
  });

  it('falls back to the org-blended avg value when a practice has revenue but no active patients', async () => {
    stub({
      practices: [{ id: 'p1', name: 'Big' }, { id: 'p2', name: 'NewBuy' }],
      ret: [
        { practice_id: 'p1', active_patients: 1000, lapsed_patients: 0, dormant_patients: 0, total_patients: 1000, unlinked_appts: 0 },
        // p2 has lapsed patients but zero active -> no own avg, uses org blend
        { practice_id: 'p2', active_patients: 0, lapsed_patients: 50, dormant_patients: 0, total_patients: 50, unlinked_appts: 0 },
      ],
      rev: [{ practice_id: 'p1', pence: 50_000_000 }], // org avg = 50,000,000/1000 = 50000p
    });
    const r = await analyticsService.retention(ORG, { scope: 'all', now: NOW });
    const p2 = r.practices.find((x) => x.practiceId === 'p2');
    expect(p2.avgPatientValuePence).toBe(50_000); // org blend
    expect(p2.reactivationValuePence).toBe(Math.round(50 * 50_000 * 0.25));
  });

  it('flags unlinked appointments as a data wall without counting them in cohorts', async () => {
    stub({
      practices: [{ id: 'p1', name: 'A' }],
      ret: [{ practice_id: 'p1', active_patients: 100, lapsed_patients: 10, dormant_patients: 5, total_patients: 115, unlinked_appts: 4200 }],
      rev: [{ practice_id: 'p1', pence: 1_000_000 }],
    });
    const r = await analyticsService.retention(ORG, { scope: 'all', now: NOW });
    expect(r.org.unlinkedAppts).toBe(4200);
    expect(r.org.knownPatients).toBe(115); // unlinked NOT added to the base
    expect(r.insights.some((i) => i.value === 'Re-sync')).toBe(true);
  });

  it('is not applicable for academy / lab scope', async () => {
    analyticsRepository.entitiesByKind = async () => [{ id: 'a1' }];
    stub({});
    const r = await analyticsService.retention(ORG, { scope: 'academy', now: NOW });
    expect(r.applicable).toBe(false);
    expect(r.scope).toBe('academy');
  });

  it('returns an honest empty state for an org with no visit history', async () => {
    stub({ practices: [{ id: 'p1', name: 'A' }], ret: [], rev: [] });
    const r = await analyticsService.retention(ORG, { scope: 'all', now: NOW });
    expect(r.hasData).toBe(false);
    expect(r.org.knownPatients).toBe(0);
    expect(r.insights[0].value).toBe('Sync needed');
  });
});
