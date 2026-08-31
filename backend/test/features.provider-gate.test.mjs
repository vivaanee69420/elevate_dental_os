// PROVIDER_FEATURE map + featuresService.orgHasProviderFeature — the runtime
// gate for the GENERIC multi-provider integration routes, where the provider
// (and so the feature key) is only known at request time. A provider absent
// from the map is not feature-bound and must pass without a lookup.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { supaRec } from './setup.js';

const { featuresService } = await import('../src/services/features.service.js');
const { PROVIDER_FEATURE } = await import('../src/lib/features.js');

describe('PROVIDER_FEATURE', () => {
  it('maps exactly the three feature-bound providers to their catalog keys', () => {
    expect(PROVIDER_FEATURE).toEqual({
      emergent: 'emergent',
      google_sheets: 'call_reporting',
      google_sheets_writer: 'sheet_export',
    });
  });
});

describe('featuresService.orgHasProviderFeature', () => {
  beforeEach(() => {
    featuresService.invalidate();
    supaRec.resultProvider = () => ({ data: [], error: null });
  });

  it('passes an unmapped provider without any org_features lookup', async () => {
    const provider = vi.fn(() => ({ data: [], error: null }));
    supaRec.resultProvider = provider;
    expect(await featuresService.orgHasProviderFeature('org-unmapped', 'dentally')).toBe(true);
    expect(await featuresService.orgHasProviderFeature('org-unmapped', 'gohighlevel')).toBe(true);
    expect(provider).not.toHaveBeenCalled();
  });

  it('denies a mapped provider when its feature defaults off and no override exists', async () => {
    expect(await featuresService.orgHasProviderFeature('org-1', 'emergent')).toBe(false);
  });

  it('allows a mapped provider when the org has the feature enabled', async () => {
    supaRec.resultProvider = (q) =>
      q.table === 'org_features'
        ? { data: [{ feature: 'emergent', enabled: true }], error: null }
        : { data: [], error: null };
    expect(await featuresService.orgHasProviderFeature('org-1', 'emergent')).toBe(true);
  });

  it('resolves google_sheets via call_reporting and google_sheets_writer via sheet_export', async () => {
    supaRec.resultProvider = (q) =>
      q.table === 'org_features'
        ? { data: [{ feature: 'call_reporting', enabled: true }], error: null }
        : { data: [], error: null };
    expect(await featuresService.orgHasProviderFeature('org-1', 'google_sheets')).toBe(true);
    expect(await featuresService.orgHasProviderFeature('org-1', 'google_sheets_writer')).toBe(false);
  });
});
