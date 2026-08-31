// backend/src/middleware/features.js
// ============================================================================
// Org-level feature gate (agency / sub-account entitlements).
//
//   requireFeature(key)  403 FEATURE_DISABLED unless the acting org's
//                        effective features enable `key`. Runs AFTER
//                        authenticate (needs req.user.organisation_id) and
//                        BEFORE any role/permission gate on the route — org
//                        entitlement is checked first; FEATURE_DISABLED to
//                        an authenticated org member is not sensitive.
//
// Resolution = code catalog defaults <- org_features rows (features.service,
// 60s cache), so this adds at most one cached lookup per org per minute.
// Unknown keys throw at wire-time — same "the code defines the keys"
// discipline as lib/permissions.js.
// ============================================================================
import { FEATURE_CATALOG } from '../lib/features.js';
import { featuresService } from '../services/features.service.js';

export function requireFeature(key) {
  if (!Object.prototype.hasOwnProperty.call(FEATURE_CATALOG, key)) {
    throw new Error(`requireFeature: unknown feature key "${key}"`);
  }
  const featureGate = async (req, res, next) => {
    if (!req.user) return res.status(403).json({ error: 'Insufficient permissions' });
    const on = await featuresService.orgHasFeature(req.user.organisation_id, key);
    if (!on) return res.status(403).json({ error: 'Feature not enabled', code: 'FEATURE_DISABLED' });
    next();
  };
  featureGate.featureKey = key; // structural-test hook (route wiring tests)
  return featureGate;
}
