// ============================================================================
// Data Quality Engine — analyticsService.dataQuality (DentaCFO gap Phase 5).
// Covers the per-practice cleanliness score (weighted, dimension-renormalised),
// the record-volume-weighted org rollup, connector staleness classification,
// and the prioritised alert list. Repository fully stubbed (no DB).
// ============================================================================
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { analyticsService } from '../src/services/analytics.service.js';
import { analyticsRepository } from '../src/repositories/analytics.repository.js';

const ORG = 'org-1';
const NOW = () => new Date('2026-06-09T12:00:00Z');

describe('analyticsService.dataQuality', () => {
  let orig;
  beforeEach(() => {
    orig = {
      practicesFull: analyticsRepository.practicesFull,
      dataQualityByPractice: analyticsRepository.dataQualityByPractice,
      connectorStates: analyticsRepository.connectorStates,
    };
  });
  afterEach(() => Object.assign(analyticsRepository, orig));

  function stub({ practices = [], dq = [], connectors = [] }) {
    analyticsRepository.practicesFull = async () => practices;
    analyticsRepository.dataQualityByPractice = async () => dq;
    analyticsRepository.connectorStates = async () => connectors;
  }

  it('scores a perfectly clean practice at 100 (green)', async () => {
    stub({
      practices: [{ id: 'p1', name: 'Central' }],
      dq: [{ practice_id: 'p1', total_appts: 100, uncoded_appts: 0, unlinked_appts: 0, unassigned_appts: 0,
             total_invoices: 50, unmatched_invoices: 0, invoiced_pence: 100000, outstanding_pence: 0 }],
    });
    const r = await analyticsService.dataQuality(ORG, { now: NOW });
    expect(r.orgScore).toBe(100);
    expect(r.rag).toBe('green');
    expect(r.practices[0].dims).toHaveLength(4);
    expect(r.alerts.filter((a) => a.area === 'practice')).toHaveLength(0);
  });

  it('weights the four dimensions and re-normalises when one is absent', async () => {
    // Appts only (no invoices): coded 80% + linked 100% over weights 0.30/0.30.
    // score = (80*.3 + 100*.3)/.6 = 90.
    stub({
      practices: [{ id: 'p1', name: 'A' }],
      dq: [{ practice_id: 'p1', total_appts: 100, uncoded_appts: 20, unlinked_appts: 0, unassigned_appts: 0,
             total_invoices: 0, unmatched_invoices: 0, invoiced_pence: 0, outstanding_pence: 0 }],
    });
    const r = await analyticsService.dataQuality(ORG, { now: NOW });
    expect(r.practices[0].dims).toHaveLength(2);
    expect(r.practices[0].score).toBe(90);
    expect(r.practices[0].rag).toBe('green');
  });

  it('flags a red practice and emits a high-severity alert, worst-first ordering', async () => {
    stub({
      practices: [{ id: 'p1', name: 'Good' }, { id: 'p2', name: 'Bad' }],
      dq: [
        { practice_id: 'p1', total_appts: 100, uncoded_appts: 0, unlinked_appts: 0, unassigned_appts: 0,
          total_invoices: 0, unmatched_invoices: 0, invoiced_pence: 0, outstanding_pence: 0 },
        // Bad: half uncoded, half unlinked -> coded 50, linked 50 -> score 50 (red).
        { practice_id: 'p2', total_appts: 100, uncoded_appts: 50, unlinked_appts: 50, unassigned_appts: 0,
          total_invoices: 0, unmatched_invoices: 0, invoiced_pence: 0, outstanding_pence: 0 },
      ],
    });
    const r = await analyticsService.dataQuality(ORG, { now: NOW });
    // worst-first
    expect(r.practices[0].name).toBe('Bad');
    expect(r.practices[0].rag).toBe('red');
    const highPractice = r.alerts.find((a) => a.key === 'practice:p2');
    expect(highPractice.severity).toBe('high');
    // org score is record-weighted (equal volume here) -> (100+50)/2 = 75 (amber)
    expect(r.orgScore).toBe(75);
    expect(r.rag).toBe('amber');
  });

  it('classifies connector staleness and errors, ranked health-worst first', async () => {
    stub({
      practices: [{ id: 'p1', name: 'A' }],
      dq: [{ practice_id: 'p1', total_appts: 10, uncoded_appts: 0, unlinked_appts: 0, unassigned_appts: 0,
             total_invoices: 0, unmatched_invoices: 0, invoiced_pence: 0, outstanding_pence: 0 }],
      connectors: [
        { provider: 'xero', status: 'connected', last_synced_at: '2026-06-09T11:00:00Z', last_error: null }, // 1h -> ok
        { provider: 'dentally', status: 'connected', last_synced_at: '2026-06-06T12:00:00Z', last_error: null }, // 72h > 36 -> stale
        { provider: 'ghl', status: 'error', last_synced_at: null, last_error: 'token revoked' },
      ],
    });
    const r = await analyticsService.dataQuality(ORG, { now: NOW });
    expect(r.connectors[0].provider).toBe('ghl'); // error ranks first
    expect(r.connectors[0].health).toBe('error');
    const dentally = r.connectors.find((c) => c.provider === 'dentally');
    expect(dentally.health).toBe('stale');
    expect(dentally.ageHours).toBe(72);
    const xero = r.connectors.find((c) => c.provider === 'xero');
    expect(xero.health).toBe('ok');
    // alerts: ghl high (error) before dentally medium (stale)
    expect(r.alerts[0].key).toBe('connector:ghl');
    expect(r.alerts[0].severity).toBe('high');
    expect(r.alerts.find((a) => a.key === 'connector:dentally').severity).toBe('medium');
  });

  it('surfaces the all-appointments-unassigned data wall as a low-severity flag, not in the score', async () => {
    stub({
      practices: [{ id: 'p1', name: 'A' }],
      dq: [{ practice_id: 'p1', total_appts: 100, uncoded_appts: 0, unlinked_appts: 0, unassigned_appts: 100,
             total_invoices: 0, unmatched_invoices: 0, invoiced_pence: 0, outstanding_pence: 0 }],
    });
    const r = await analyticsService.dataQuality(ORG, { now: NOW });
    expect(r.practices[0].score).toBe(100); // unassigned NOT scored
    const flag = r.alerts.find((a) => a.key === 'org:unassigned');
    expect(flag.severity).toBe('low');
    expect(flag.text).toContain('No clinician is mapped');
  });

  it('returns a sane empty (orgScore 100) for an org with no data', async () => {
    stub({ practices: [], dq: [], connectors: [] });
    const r = await analyticsService.dataQuality(ORG, { now: NOW });
    expect(r.orgScore).toBe(100);
    expect(r.rag).toBe('green');
    expect(r.practices).toHaveLength(0);
    expect(r.alerts).toHaveLength(0);
  });
});
