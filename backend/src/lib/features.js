// backend/src/lib/features.js
// ============================================================================
// Feature catalog + pure resolution (agency / sub-account entitlements).
//
// The catalog is the single source of truth for WHICH org-level features
// exist. org_features DB rows only OVERRIDE these code defaults — a key the
// code never checks grants nothing, so the DB can't invent features.
//
//   internal (default OFF)  bespoke agency-only features; seeded ON for orgs
//                           existing at migration 000133 time
//   module   (default ON)   one per top-level sidebar group; per-sub-account
//                           toggles + route enforcement land in phase A3
//                           (navSection ties the key to frontend/lib/nav.ts)
//
// resolveEffectiveFeatures() is pure: same inputs -> same output, no I/O.
// Spec: docs/superpowers/specs/2026-08-31-saas-feature-gating-and-isolation-design.md
// ============================================================================

export const FEATURE_CATALOG = {
  data_room:      { label: 'Data Room (raw source data & exports)', kind: 'internal', default: false },
  emergent:       { label: 'Emergent (Treatments Accepted) integration', kind: 'internal', default: false },
  call_reporting: { label: 'Call Reporting (lead response dashboard)', kind: 'internal', default: false },
  sheet_export:   { label: 'GHL to Dentally conversion sheet export', kind: 'internal', default: false },

  finance:         { label: 'Finance', kind: 'module', default: true, navSection: 'Finance' },
  business_health: { label: 'Business Health', kind: 'module', default: true, navSection: 'Business Health' },
  operations:      { label: 'Operations', kind: 'module', default: true, navSection: 'Operations' },
  growth:          { label: 'Growth', kind: 'module', default: true, navSection: 'Growth' },
  crm:             { label: 'Elevate CRM', kind: 'module', default: true, navSection: 'Elevate CRM' },
  wealth:          { label: 'Wealth', kind: 'module', default: true, navSection: 'Wealth' },
  training:        { label: 'Training', kind: 'module', default: true, navSection: 'Training' },
  system:          { label: 'System (settings & integrations)', kind: 'module', default: true, navSection: 'System' },
};

export const FEATURE_KEYS = Object.keys(FEATURE_CATALOG);

export function defaultFeatures() {
  const out = {};
  for (const [k, v] of Object.entries(FEATURE_CATALOG)) out[k] = v.default;
  return out;
}

// rows: [{ feature, enabled }] from org_features (or null). Unknown keys are
// ignored; enabled must be literally true to grant.
export function resolveEffectiveFeatures(rows) {
  const out = defaultFeatures();
  for (const r of rows || []) {
    if (r && Object.prototype.hasOwnProperty.call(FEATURE_CATALOG, r.feature)) {
      out[r.feature] = r.enabled === true;
    }
  }
  return out;
}
