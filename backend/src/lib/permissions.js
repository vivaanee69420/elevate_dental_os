'use strict';

// ============================================================================
// Permission catalog + pure resolution
// ============================================================================
// The catalog is the single source of truth for WHICH permissions can be
// granted. Every key here must map to a real enforcement point (a
// requirePermission() route gate or a frontend nav/route guard) — a key the
// code never checks grants nothing, so we never let the DB invent keys.
//
// Resolution precedence (lowest to highest):
//
//     catalog default (deny)
//        └─< role_permissions[org, role]   (admin-configured, per org)
//              └─< users.permissions JSONB  (per-user override by owner)
//
// resolveEffectivePermissions() is pure: same inputs -> same output, no I/O.
// The service layer fetches the two data sources and calls this.
// ============================================================================

// permission_key -> human label (label is for the admin UI / docs only).
const PERMISSION_CATALOG = {
  'finance.view': 'View finance (cash flow, P&L, financial)',
  'valuation.view': 'View practice valuation',
  'businesshealth.manage': 'Manage Business Health setup & targets',
  'operations.view': 'View operations (associates, staff, chair, UDA)',
  'intelligence.view': 'View intelligence (scenarios, tax, debt, alerts)',
  'growth.view': 'View growth (marketing, loyalty, reviews, booking)',
  'crm.view': 'View CRM (inbox, pipeline, contacts)',
  'crm.manage': 'Manage CRM (edit leads, workflows, templates)',
  'wealth.view': 'View wealth (net worth, property, pensions, FIRE)',
  'training.view': 'View training modules',
  'system.manage': 'Manage system settings & integrations',
  'users.invite': 'Invite team members',
  'users.manage': 'Edit/remove team members',
  'permissions.manage': 'Edit the role-permission matrix',
};

const PERMISSION_KEYS = Object.keys(PERMISSION_CATALOG);

/** True if `key` is a real, grantable permission. */
function isValidPermission(key) {
  return Object.prototype.hasOwnProperty.call(PERMISSION_CATALOG, key);
}

/**
 * Resolve a user's effective permissions.
 *
 * @param {Array<{permission_key:string, allowed:boolean}>} rolePermissionRows
 *        role_permissions rows for this user's (org, role).
 * @param {Object} userOverrides  users.permissions JSONB: { key: boolean }.
 *        Only keys explicitly present override the role default.
 * @returns {Object} { [permission_key]: boolean } for every catalog key.
 *
 * Unknown keys in either source are ignored (catalog is authoritative).
 */
function resolveEffectivePermissions(rolePermissionRows, userOverrides) {
  const effective = {};
  // 1. Catalog default: deny everything.
  for (const key of PERMISSION_KEYS) effective[key] = false;
  // 2. Apply admin-configured role defaults.
  for (const row of rolePermissionRows || []) {
    if (isValidPermission(row.permission_key)) {
      effective[row.permission_key] = !!row.allowed;
    }
  }
  // 3. Apply per-user overrides (only keys explicitly set).
  if (userOverrides && typeof userOverrides === 'object') {
    for (const key of Object.keys(userOverrides)) {
      if (isValidPermission(key)) effective[key] = !!userOverrides[key];
    }
  }
  return effective;
}

module.exports = {
  PERMISSION_CATALOG,
  PERMISSION_KEYS,
  isValidPermission,
  resolveEffectivePermissions,
};
