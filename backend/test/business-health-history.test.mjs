// ============================================================================
// Manual-input history (000054): every owner save stamps a point-in-time copy
// of baseline/targets/manual into business_health_snapshots.inputs, and an
// as-of read rewinds those manual anchors to what they WERE on a past date.
// ============================================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../src/services/analytics.service.js', () => ({
  analyticsService: {
    dashboardSummary: vi.fn(async () => ({
      basis: 'actuals', revenuePence: 120000000, netProfitPence: 18000000,
      marginPct: 15, cashflowPence: 5000000,
    })),
    businessHub: vi.fn(async () => ({ group: { conversionRate: 11.5, noShowRate: 4.2 } })),
  },
}));

const { supaRec } = await import('./setup.js');
const { analyticsService } = await import('../src/services/analytics.service.js');
const svc = (await import('../src/services/business-health.service.js')).businessHealthService;
const ORG = 'org-hist-1';

describe('business-health manual-input history capture', () => {
  let snapshotWrites;
  beforeEach(() => {
    snapshotWrites = [];
    supaRec.last = undefined;
    supaRec.resultProvider = (q) => {
      if (q.table === 'business_health_snapshots') {
        if (q.op === 'select') return { data: null, error: null };        // no row yet -> insert path
        if (q.op === 'insert') { snapshotWrites.push(q.insertVals); return { data: q.insertVals, error: null }; }
        return { data: null, error: null };
      }
      if (q.table === 'business_health') {
        // .select() after .upsert() flips q.op to 'select'; distinguish the
        // upsert chain by its recorded upsertVals.
        if (q.upsertVals) return { data: { baseline: { revenue: 100 }, targets: { profit_multiple: 2 }, manual: {} }, error: null };
        if (q.op === 'select') return { data: { baseline: { revenue: 50 }, targets: {}, manual: {}, setup_completed_at: '2026-01-01' }, error: null };
        if (q.op === 'update') return { data: { manual: {} }, error: null };
      }
      return { data: [], error: null };
    };
  });

  it('update() stamps an inputs snapshot from the just-saved row', async () => {
    await svc.update(ORG, 'owner', { baseline: { revenue: 100 } });
    expect(snapshotWrites.length).toBe(1);
    expect(snapshotWrites[0].inputs.baseline).toEqual({ revenue: 100 });
    expect(snapshotWrites[0].organisation_id).toBe(ORG);
    expect(snapshotWrites[0].label).toBe('inputs');
  });

  it('updateMetric() stamps an inputs snapshot carrying the new KPI', async () => {
    supaRec.resultProvider = (q) => {
      if (q.table === 'business_health_snapshots') {
        if (q.op === 'select') return { data: null, error: null };
        if (q.op === 'insert') { snapshotWrites.push(q.insertVals); return { data: q.insertVals, error: null }; }
        return { data: null, error: null };
      }
      // setManualMetric reads then writes manual; getMetricsData re-reads it.
      if (q.table === 'business_health') return { data: { baseline: {}, targets: {}, manual: { nps: { value: 64, asof: '2026-06-01' } } }, error: null };
      return { data: [], error: null };
    };
    await svc.updateMetric(ORG, 'owner', 'nps', 64);
    expect(snapshotWrites.length).toBe(1);
    expect(snapshotWrites[0].inputs.manual.nps.value).toBe(64);
  });
});

describe('business-health metrics() as-of read', () => {
  beforeEach(() => {
    supaRec.last = undefined;
    analyticsService.dashboardSummary.mockClear();
    analyticsService.businessHub.mockClear();
  });

  it('asOf rewinds baseline/targets/manual to the historical snapshot, NOT the live row', async () => {
    supaRec.resultProvider = (q) => {
      if (q.table === 'business_health_snapshots' && q.op === 'select') {
        // Two rows <= asOf; the newer (with inputs) wins, the cron row is skipped.
        return {
          data: [
            { snapshot_date: '2026-03-10', inputs: { baseline: { nps: 50 }, targets: {}, manual: { nps: { value: 55, asof: '2026-03-10' } } } },
            { snapshot_date: '2026-02-01', inputs: null },
          ],
          error: null,
        };
      }
      // If the service wrongly read the LIVE row it would get nps=99.
      if (q.table === 'business_health') return { data: { baseline: { nps: 99 }, targets: {}, manual: { nps: { value: 99, asof: '2026-06-01' } } }, error: null };
      return { data: [], error: null };
    };

    const { metrics } = await svc.metrics(ORG, 'owner', { asOf: '2026-03-31' });
    const nps = metrics.find((m) => m.key === 'nps');
    expect(nps.current).toBe(55);          // historical, not live 99
    expect(nps.baseline).toBe(50);         // historical baseline, not live 99
    // analytics windowed to the as-of upper bound
    expect(analyticsService.businessHub).toHaveBeenCalledWith(ORG, { until: '2026-03-31' });
  });

  it('no asOf reads the live row and does not window analytics', async () => {
    supaRec.resultProvider = (q) =>
      q.table === 'business_health'
        ? { data: { baseline: { nps: 99 }, targets: {}, manual: { nps: { value: 99, asof: '2026-06-01' } } }, error: null }
        : { data: [], error: null };
    const { metrics } = await svc.metrics(ORG, 'owner', {});
    const nps = metrics.find((m) => m.key === 'nps');
    expect(nps.current).toBe(99);
    expect(analyticsService.businessHub).toHaveBeenCalledWith(ORG, {});
  });
});
