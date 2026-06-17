import { describe, it, expect, beforeEach } from 'vitest';
import { METRIC_CATALOG, METRIC_BY_KEY } from '../src/lib/health-metrics.js';

describe('health metric catalog', () => {
  it('every entry has the required shape and a valid sourceType', () => {
    for (const m of METRIC_CATALOG) {
      expect(typeof m.key).toBe('string');
      expect(typeof m.label).toBe('string');
      expect(['Financial', 'Patient', 'Conversion', 'Operational']).toContain(m.cat);
      expect(['%', '£', 'min', '']).toContain(m.unit);
      expect(['higher', 'lower']).toContain(m.better);
      expect(['auto', 'manual']).toContain(m.sourceType);
    }
  });

  it('keys are unique and METRIC_BY_KEY indexes them', () => {
    const keys = METRIC_CATALOG.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(METRIC_BY_KEY[keys[0]]).toBe(METRIC_CATALOG[0]);
  });

  it('exposes exactly the six auto metrics wired to live actuals', () => {
    const auto = METRIC_CATALOG.filter((m) => m.sourceType === 'auto').map((m) => m.key).sort();
    expect(auto).toEqual(
      ['annual_revenue', 'cash_at_bank', 'fta_no_show_rate', 'lead_to_treatment', 'net_profit', 'net_profit_margin'].sort(),
    );
  });
});

import { vi } from 'vitest';

// Stub analytics so the resolver is tested in isolation from rollup SQL.
vi.mock('../src/services/analytics.service.js', () => ({
  analyticsService: {
    dashboardSummary: vi.fn(async () => ({
      basis: 'actuals', revenuePence: 120000000, netProfitPence: 18000000,
      marginPct: 15, cashflowPence: 5000000,
    })),
    businessHub: vi.fn(async () => ({
      group: { conversionRate: 11.5, noShowRate: 4.2 },
    })),
  },
}));

const { supaRec } = await import('./setup.js');
const { analyticsService } = await import('../src/services/analytics.service.js');
const svc = (await import('../src/services/business-health.service.js')).businessHealthService;
const ORG = 'org-hhhhhhhh';

describe('businessHealthService.metrics', () => {
  beforeEach(() => {
    supaRec.last = undefined;
    supaRec.rpcProvider = undefined;
    supaRec.resultProvider = () => ({ data: [], error: null });
  });

  it('resolves auto metrics from live actuals and manual from the JSONB column', async () => {
    supaRec.resultProvider = (q) =>
      q.table === 'business_health'
        ? { data: { baseline: { annual_revenue: 1000000, nps: 50 }, targets: {}, manual: { nps: { value: 64, asof: '2026-06-01' } } }, error: null }
        : { data: [], error: null };

    const { metrics } = await svc.metrics(ORG, 'owner');
    const rev = metrics.find((m) => m.key === 'annual_revenue');
    expect(rev.current).toBe(1200000);          // 120000000 pence / 100
    expect(rev.source).toBe('actuals');
    const nps = metrics.find((m) => m.key === 'nps');
    expect(nps.current).toBe(64);
    expect(nps.source).toBe('manual');
    expect(nps.asof).toBe('2026-06-01');
  });

  it('flags unset manual metrics with needsInput and null current', async () => {
    supaRec.resultProvider = (q) =>
      q.table === 'business_health'
        ? { data: { baseline: {}, targets: {}, manual: {} }, error: null }
        : { data: [], error: null };
    const { metrics } = await svc.metrics(ORG, 'owner');
    const recall = metrics.find((m) => m.key === 'recall_compliance');
    expect(recall.current).toBeNull();
    expect(recall.needsInput).toBe(true);
  });

  it('net profit/margin are "no data" (null + needsInput), not a fake £0, when no cost feed', async () => {
    // 'revenue-only' basis = real revenue, no QuickBooks/Xero cost feed -> PL
    // yields 0 cost => 0 profit. That must NOT render as a genuine £0 profit.
    analyticsService.dashboardSummary.mockResolvedValueOnce({
      basis: 'revenue-only', revenuePence: 90000000, netProfitPence: 0,
      marginPct: 0, cashflowPence: 4000000,
    });
    supaRec.resultProvider = (q) =>
      q.table === 'business_health'
        ? { data: { baseline: {}, targets: {}, manual: {} }, error: null }
        : { data: [], error: null };

    const { metrics } = await svc.metrics(ORG, 'owner');
    const by = (k) => metrics.find((m) => m.key === k);

    // Revenue is still real and present.
    expect(by('annual_revenue').current).toBe(900000);

    const profit = by('net_profit');
    expect(profit.current).toBeNull();
    expect(profit.needsInput).toBe(true);
    expect(profit.source).toBe('no data');

    const margin = by('net_profit_margin');
    expect(margin.current).toBeNull();
    expect(margin.needsInput).toBe(true);
    expect(margin.source).toBe('no data');
  });

  it('reception gets an empty stub (CRM-only rule)', async () => {
    const out = await svc.metrics(ORG, 'reception');
    expect(out).toEqual({ metrics: [] });
  });

  it('hybrid metrics resolve to live computed values (Dentally/grid) over manual', async () => {
    supaRec.rpcProvider = (fn) => {
      if (fn === 'health_patient_actuals')
        return { data: { new_patients_month: 305, active_patients: 5515, retention_12mo: 37.1, recall_compliance: null }, error: null };
      if (fn === 'health_production_actuals')
        return { data: { avg_case_value_pence: 69474, production_per_associate_pence: 48498 }, error: null };
      return { data: null, error: { message: 'unstubbed' } };
    };
    supaRec.resultProvider = (q) => {
      if (q.table === 'business_health')
        // A stale manual new_patients_month must be overridden by the live value.
        return { data: { baseline: {}, targets: {}, manual: { new_patients_month: { value: 99, asof: '2026-01-01' } } }, error: null };
      if (q.table === 'chair_utilisation')
        return { data: [{ booked_minutes: 80, available_minutes: 100 }], error: null };
      return { data: [], error: null };
    };

    const { metrics } = await svc.metrics(ORG, 'owner');
    const by = (k) => metrics.find((m) => m.key === k);

    const newp = by('new_patients_month');
    expect(newp.current).toBe(305);            // live wins over manual 99
    expect(newp.source).toBe('dentally');
    expect(newp.sourceType).toBe('auto');      // renders as a source-chip tile
    expect(by('active_patients').current).toBe(5515);
    expect(by('retention_12mo').current).toBe(37.1);
    expect(by('avg_case_value').current).toBe(694.7);   // 69474 pence -> £
    expect(by('avg_case_value').source).toBe('dentally');
    expect(by('chair_utilisation').current).toBe(80);   // 80/100 booked/available
    expect(by('chair_utilisation').source).toBe('grid');

    // recall_compliance has no source signal (null) and no manual entry -> manual/needsInput.
    const recall = by('recall_compliance');
    expect(recall.current).toBeNull();
    expect(recall.sourceType).toBe('manual');
    expect(recall.needsInput).toBe(true);
  });

  it('hybrid metrics fall back to manual when the live source is empty/absent', async () => {
    // rpcProvider default returns an error -> resolveComputed catches -> null.
    supaRec.resultProvider = (q) =>
      q.table === 'business_health'
        ? { data: { baseline: {}, targets: {}, manual: { active_patients: { value: 16200, asof: '2026-05-01' } } }, error: null }
        : { data: [], error: null };

    const { metrics } = await svc.metrics(ORG, 'owner');
    const active = metrics.find((m) => m.key === 'active_patients');
    expect(active.current).toBe(16200);
    expect(active.sourceType).toBe('manual');
    expect(active.source).toBe('manual');
    expect(active.asof).toBe('2026-05-01');

    // No manual entry + no live data -> needsInput.
    const prod = metrics.find((m) => m.key === 'production_per_associate');
    expect(prod.current).toBeNull();
    expect(prod.needsInput).toBe(true);
  });

  it('as-of (historical) reads do NOT use live computed values', async () => {
    supaRec.rpcProvider = (fn) =>
      fn === 'health_patient_actuals'
        ? { data: { new_patients_month: 305, active_patients: 5515 }, error: null }
        : { data: null, error: { message: 'unstubbed' } };
    supaRec.resultProvider = () => ({ data: [], error: null }); // getInputsAsOf -> no snapshot

    const { metrics } = await svc.metrics(ORG, 'owner', { asOf: '2026-01-31' });
    const newp = metrics.find((m) => m.key === 'new_patients_month');
    // History replays the manual snapshot; computed live value is ignored.
    expect(newp.current).toBeNull();
    expect(newp.sourceType).toBe('manual');
  });
});

describe('businessHealthService.updateMetric', () => {
  beforeEach(() => {
    supaRec.last = undefined;
    supaRec.resultProvider = (q) =>
      q.table === 'business_health' ? { data: { manual: {} }, error: null } : { data: [], error: null };
  });

  it('owner can set a manual metric; write is org-scoped', async () => {
    const out = await svc.updateMetric(ORG, 'owner', 'nps', 64);
    expect(out.value).toBe(64);
    expect(typeof out.asof).toBe('string');
    const upd = supaRec.last; // last op is the update on business_health
    expect(upd.eqs.find((e) => e.col === 'organisation_id')).toEqual({ col: 'organisation_id', val: ORG });
  });

  it('reception/PM cannot write (403)', async () => {
    await expect(svc.updateMetric(ORG, 'reception', 'nps', 64)).rejects.toMatchObject({ statusCode: 403 });
    await expect(svc.updateMetric(ORG, 'practice_manager', 'nps', 64)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('rejects an unknown key (400)', async () => {
    await expect(svc.updateMetric(ORG, 'owner', 'not_a_metric', 1)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects an auto-sourced key (400 — not manually editable)', async () => {
    await expect(svc.updateMetric(ORG, 'owner', 'annual_revenue', 1)).rejects.toMatchObject({ statusCode: 400 });
  });
});
