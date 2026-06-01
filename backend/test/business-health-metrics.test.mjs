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
const svc = (await import('../src/services/business-health.service.js')).businessHealthService;
const ORG = 'org-hhhhhhhh';

describe('businessHealthService.metrics', () => {
  beforeEach(() => {
    supaRec.last = undefined;
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

  it('reception gets an empty stub (CRM-only rule)', async () => {
    const out = await svc.metrics(ORG, 'reception');
    expect(out).toEqual({ metrics: [] });
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
