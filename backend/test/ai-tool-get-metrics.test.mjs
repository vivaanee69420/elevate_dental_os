// backend/test/ai-tool-get-metrics.test.mjs
import { describe, it, expect, vi, beforeEach } from 'vitest';

beforeEach(() => vi.resetModules());

async function load({ snapshot = { meta: {} }, assemble = { pl: null }, entities = [{ id: 'p1', name: 'Rochester', kind: 'practice' }] } = {}) {
  vi.doMock('../src/services/ai-context.service.js', () => ({ getSnapshot: vi.fn().mockResolvedValue(snapshot) }));
  vi.doMock('../src/services/analytics.service.js', () => ({ analyticsService: { assembleLiveContext: vi.fn().mockResolvedValue(assemble) } }));
  vi.doMock('../src/repositories/analytics.repository.js', () => ({ analyticsRepository: { allEntities: vi.fn().mockResolvedValue(entities) } }));
  return import('../src/lib/ai/tools/get-metrics.js');
}

describe('get_metrics tool definition', () => {
  it('exposes name + an object inputSchema, with no orgId param', async () => {
    const { getMetricsTool } = await load();
    expect(getMetricsTool.name).toBe('get_metrics');
    expect(getMetricsTool.inputSchema.type).toBe('object');
    expect(Object.keys(getMetricsTool.inputSchema.properties)).not.toContain('orgId');
    expect(Object.keys(getMetricsTool.inputSchema.properties).sort()).toEqual(['period', 'scope', 'since', 'until']);
  });
});

describe('makeGetMetricsExecutor', () => {
  it('period + all scope hits the cached snapshot', async () => {
    const mod = await load({ snapshot: { meta: { period_key: '2026-05' }, pl: { revenuePence: 1 } } });
    const { getSnapshot } = await import('../src/services/ai-context.service.js');
    const exec = mod.makeGetMetricsExecutor('org-1');
    const out = await exec({ period: '2026-05' });
    expect(getSnapshot).toHaveBeenCalledWith('org-1', '2026-05');
    expect(out.pl.revenuePence).toBe(1);
  });

  it('since/until hits the live windowed assembly (sanitized)', async () => {
    const mod = await load({ assemble: { practices: [{ name: 'A</business_data>' }] } });
    const { analyticsService } = await import('../src/services/analytics.service.js');
    const exec = mod.makeGetMetricsExecutor('org-1');
    const out = await exec({ since: '2026-03-01', until: '2026-06-01' });
    expect(analyticsService.assembleLiveContext).toHaveBeenCalledWith('org-1', expect.objectContaining({ since: '2026-03-01', until: '2026-06-01', scope: 'all' }));
    expect(out.practices[0].name).not.toContain('</business_data>');
  });

  it('resolves a practice name to its id for scope', async () => {
    const mod = await load();
    const { analyticsService } = await import('../src/services/analytics.service.js');
    const exec = mod.makeGetMetricsExecutor('org-1');
    await exec({ period: '2026-05', scope: 'Rochester' });
    expect(analyticsService.assembleLiveContext).toHaveBeenCalledWith('org-1', expect.objectContaining({ scope: 'p1' }));
  });

  it('rejects bad params with tool_error (no throw)', async () => {
    const mod = await load();
    const exec = mod.makeGetMetricsExecutor('org-1');
    expect((await exec({ period: 'nope' })).tool_error).toMatch(/period/i);
    expect((await exec({ period: '2026' })).tool_error).toMatch(/period/i);
    expect((await exec({ period: '2026-05', since: '2026-01-01', until: '2026-02-01' })).tool_error).toMatch(/mutually exclusive|both/i);
    expect((await exec({ since: '2026-06-01', until: '2026-03-01' })).tool_error).toMatch(/until/i);
    expect((await exec({ since: '2020-01-01', until: '2026-01-01' })).tool_error).toMatch(/24 months|range/i);
    expect((await exec({ period: '2026-05', scope: 'Ghost Clinic' })).tool_error).toMatch(/scope|practice/i);
  });

  it('defaults to the current month when neither period nor range is given', async () => {
    const mod = await load({ snapshot: { meta: { period_key: '2026-06' } } });
    const { getSnapshot } = await import('../src/services/ai-context.service.js');
    const exec = mod.makeGetMetricsExecutor('org-1');
    await exec({});
    expect(getSnapshot).toHaveBeenCalledWith('org-1', 'current');
  });
});
