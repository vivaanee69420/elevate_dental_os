// backend/test/features.service.test.mjs
// Effective-feature resolution: org-scoped query, 60s cache, defaults on error.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { supaRec } from './setup.js';

const { featuresService } = await import('../src/services/features.service.js');
const { defaultFeatures } = await import('../src/lib/features.js');

describe('featuresService', () => {
  beforeEach(() => {
    featuresService.invalidate();
    supaRec.resultProvider = () => ({ data: [], error: null });
  });

  it('queries org_features scoped to the org and applies overrides', async () => {
    supaRec.resultProvider = (q) =>
      q.table === 'org_features'
        ? { data: [{ feature: 'data_room', enabled: true }], error: null }
        : { data: [], error: null };
    const f = await featuresService.getEffectiveFeatures('org-1');
    expect(f.data_room).toBe(true);
    expect(f.emergent).toBe(false);
    expect(supaRec.last.table).toBe('org_features');
    expect(supaRec.last.eqs).toEqual(
      expect.arrayContaining([{ col: 'organisation_id', val: 'org-1' }]),
    );
  });

  it('caches per org inside the TTL (one query for two calls)', async () => {
    const provider = vi.fn(() => ({ data: [], error: null }));
    supaRec.resultProvider = provider;
    await featuresService.getEffectiveFeatures('org-1');
    await featuresService.getEffectiveFeatures('org-1');
    expect(provider).toHaveBeenCalledTimes(1);
    await featuresService.getEffectiveFeatures('org-2');
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it('falls back to catalog defaults on a lookup error', async () => {
    supaRec.resultProvider = () => ({ data: null, error: { message: 'boom' } });
    const f = await featuresService.getEffectiveFeatures('org-1');
    expect(f).toEqual(defaultFeatures());
  });

  it('orgHasFeature and enabledKeys derive from the effective map', async () => {
    supaRec.resultProvider = () => ({
      data: [{ feature: 'emergent', enabled: true }, { feature: 'finance', enabled: false }],
      error: null,
    });
    expect(await featuresService.orgHasFeature('org-1', 'emergent')).toBe(true);
    expect(await featuresService.orgHasFeature('org-1', 'finance')).toBe(false);
    const keys = await featuresService.enabledKeys('org-1');
    expect(keys).toContain('emergent');
    expect(keys).not.toContain('finance');
    expect(keys).not.toContain('data_room');
  });
});
