// ============================================================================
// Smoke test for the analytics.service -> ai-context.service delegation.
// In its OWN file so the vi.doMock of ai-context.service.js gets a clean module
// registry (vi.resetModules does NOT clear doMock registrations, so mixing this
// with ai-context-build.test.mjs's analytics.service mocks would cross-pollute).
// ============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe('analyticsService.getLiveContextData delegation', () => {
  it('routes through getSnapshot (current period) and returns its bundle', async () => {
    const getSnapshot = vi.fn(async () => ({ meta: { period_key: '2026-06' }, pl: null }));
    vi.doMock('../src/services/ai-context.service.js', () => ({ getSnapshot }));

    const { analyticsService } = await import('../src/services/analytics.service.js');
    const out = await analyticsService.getLiveContextData('org-1');

    expect(getSnapshot).toHaveBeenCalledWith('org-1', 'current');
    expect(out.meta.period_key).toBe('2026-06');
  });
});
