// backend/src/services/features.service.js
// ============================================================================
// Org feature resolution — org_features DB overrides over the code catalog,
// behind a 60s in-process cache so requireFeature stays off the hot path.
// Fail-safe: any lookup error falls back to catalog defaults — internal
// features deny (default off), product modules stay up (default on) — so a
// DB blip can hide the Data Room for a minute but never blank the product.
// The error fallback is cached like a normal result (60s ceiling).
// ============================================================================
import { serviceClient } from '../lib/supabase.js';
import { defaultFeatures, resolveEffectiveFeatures, PROVIDER_FEATURE } from '../lib/features.js';

const TTL_MS = 60_000;
const cache = new Map(); // orgId -> { at, features }

export const featuresService = {
  async getEffectiveFeatures(orgId) {
    const hit = cache.get(orgId);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.features;
    let features;
    try {
      const { data, error } = await serviceClient
        .from('org_features')
        .select('feature, enabled')
        .eq('organisation_id', orgId);
      if (error) throw error;
      features = resolveEffectiveFeatures(data);
    } catch (err) {
      console.error('[features] lookup failed; using catalog defaults', orgId, err?.message || err);
      features = defaultFeatures();
    }
    cache.set(orgId, { at: Date.now(), features });
    return features;
  },

  async orgHasFeature(orgId, key) {
    const f = await featuresService.getEffectiveFeatures(orgId);
    return f[key] === true;
  },

  async enabledKeys(orgId) {
    const f = await featuresService.getEffectiveFeatures(orgId);
    return Object.keys(f).filter((k) => f[k] === true);
  },

  // Resolves PROVIDER_FEATURE for `provider` and checks it. A provider
  // absent from the map is not feature-bound and always resolves true — the
  // generic multi-provider integration routes/service methods use this to
  // gate the three feature-bound providers (emergent, google_sheets,
  // google_sheets_writer) without needing a static per-route requireFeature.
  async orgHasProviderFeature(orgId, provider) {
    const key = PROVIDER_FEATURE[provider];
    if (!key) return true;
    return featuresService.orgHasFeature(orgId, key);
  },

  // A2's toggle endpoint calls this after a PATCH; tests use it as a reset.
  invalidate(orgId) {
    if (orgId) cache.delete(orgId);
    else cache.clear();
  },
};
