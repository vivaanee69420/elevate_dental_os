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
//        └─< CODE role defaults (DEFAULT_ROLE_PERMISSIONS)  <-- never absent
//              └─< role_permissions[org, role]   (admin DB overrides)
//                    └─< users.permissions JSONB  (per-user override)
//
// The CODE role-default layer is the permanent safety net: if the DB
// role_permissions table is empty, missing, unseeded, or unreachable
// (stale PostgREST cache, migration not run), an owner still resolves to
// full access and a reception user to CRM-only — the system is never
// silently locked out by DB/infra state. The DB layer only *overrides*
// these code defaults, so dynamic admin editing still works.
//
// resolveEffectivePermissions() is pure: same inputs -> same output, no I/O.
// ============================================================================

// permission_key -> human label (label is for the admin UI / docs only).
export const PERMISSION_CATALOG = {
  'finance.view': 'View finance (cash flow, P&L, financial)',
  'finance.edit': 'Edit finance config & scenario sheets (chair config, P&L sheets)',
  'valuation.view': 'View practice valuation',
  'valuation.edit': 'Edit valuation inputs (EBITDA, drivers, sale plan)',
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
  'data.export': 'View & export raw source data (Data Room)',
};

export const PERMISSION_KEYS = Object.keys(PERMISSION_CATALOG);

// Built-in roles. Single source for every enum/validation in the backend.
export const ROLES = ['owner', 'practice_manager', 'reception', 'analyst'];

// Code-defined default grants per built-in role. Source of truth for the
// baseline (mirrors the SQL seed in 20260101000005). Any key omitted for a
// role defaults to false. Honors project rule 5:
//   owner             -> everything
//   practice_manager  -> ops/growth/CRM/training (no finance/wealth/system/perms)
//   reception         -> CRM essentials only
//   analyst           -> Data Room only (data.export)
export const DEFAULT_ROLE_PERMISSIONS = {
  owner: PERMISSION_KEYS.reduce((m, k) => ((m[k] = true), m), {}),
  practice_manager: {
    'operations.view': true,
    'growth.view': true,
    'crm.view': true,
    'crm.manage': true,
    'training.view': true,
  },
  reception: {
    'crm.view': true,
  },
  analyst: {
    'data.export': true,
  },
};

/** True if `key` is a real, grantable permission. */
export function isValidPermission(key) {
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
export function resolveEffectivePermissions(rolePermissionRows, userOverrides, role) {
  const effective = {};
  // 1. Catalog default: deny everything.
  for (const key of PERMISSION_KEYS) effective[key] = false;
  // 2. CODE role defaults (the permanent safety net). Applied when a known
  //    role is supplied; absent role keeps legacy deny-all base.
  const codeDefaults = role && DEFAULT_ROLE_PERMISSIONS[role];
  if (codeDefaults) {
    for (const key of Object.keys(codeDefaults)) {
      if (isValidPermission(key)) effective[key] = !!codeDefaults[key];
    }
  }
  // 3. DB role_permissions overrides (admin-configured, per org).
  for (const row of rolePermissionRows || []) {
    if (isValidPermission(row.permission_key)) {
      effective[row.permission_key] = !!row.allowed;
    }
  }
  // 4. Per-user overrides (only keys explicitly set).
  if (userOverrides && typeof userOverrides === 'object') {
    for (const key of Object.keys(userOverrides)) {
      if (isValidPermission(key)) effective[key] = !!userOverrides[key];
    }
  }
  return effective;
}

/** Pure code-default resolution for a role (no DB) — used as the fail-safe
 *  fallback when role_permissions cannot be read. */
export function defaultPermissionsForRole(role, userOverrides) {
  return resolveEffectivePermissions([], userOverrides, role);
}

// Default export mirrors the named exports — some test modules import the
// whole module as `pkg` / `permPkg.default`.
export default {
  PERMISSION_CATALOG,
  PERMISSION_KEYS,
  DEFAULT_ROLE_PERMISSIONS,
  isValidPermission,
  resolveEffectivePermissions,
  defaultPermissionsForRole,
};
