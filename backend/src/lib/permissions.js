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
  // The Overview tabs that are NOT finance surfaces (Task Manager,
  // Mastermind AI). The finance-backed Overview tabs (Command Centre,
  // Business Hub, Daily Cockpit, Practice Deep Dive, AI Analyst, Day)
  // are gated on finance.view, because that is what their endpoints
  // require — nav and API must name the same key or a tab appears and
  // then 403s.
  'overview.view': 'View the Overview section (Task Manager, Mastermind AI)',
  'intelligence.view': 'View intelligence (scenarios, tax, debt, alerts)',
  'growth.view': 'View growth (marketing, loyalty, reviews, booking)',
  'marketing.view': 'View marketing (campaigns, ad spend, cost per lead)',
  'crm.view': 'View CRM (inbox, pipeline, contacts)',
  'crm.manage': 'Manage CRM (edit leads, workflows, templates)',
  'wealth.view': 'View wealth (net worth, property, pensions, FIRE)',
  'training.view': 'View training modules',
  'system.manage': 'Manage system settings & integrations',
  'users.invite': 'Invite team members',
  'users.manage': 'Edit/remove team members',
  'permissions.manage': 'Edit the role-permission matrix',
  'data.export': 'View & export raw source data (Data Room)',
  // Payroll sits inside Operations but is deliberately NOT covered by
  // operations.view: approving a pay run moves money. It gets its own key so
  // an owner can hand out the rest of Operations without handing out payroll.
  // Owner-only by default (owner holds every key; no other role lists it).
  'payrun.manage': 'View & approve pay runs (payroll)',
};

export const PERMISSION_KEYS = Object.keys(PERMISSION_CATALOG);

// ---------------------------------------------------------------------------
// PAGE-LEVEL GRANTS (two-level model)
//
// A section key (operations.view) is the DEFAULT for every page in that
// section. An owner who wants to hand out one page rather than the whole
// section sets an explicit page key — `page:appointments` — which overrides
// the section for that page only. Nothing else changes: a section grant with
// no page overrides behaves exactly as it did before, so existing grants keep
// working and there is no migration.
//
// Effective(page) = explicit page key if one is set, else the section key.
//
// This map mirrors frontend lib/permissions.ts ROUTE_PERMISSION, which the
// nav reads. test/page-permissions.test.mjs reads that file and fails if the
// two drift, because a page the backend does not know about would silently
// fall back to its section and quietly ignore the owner's override.
// ---------------------------------------------------------------------------
export const PAGE_SECTION = {
  'cockpit': 'finance.view',
  'ad-performance': 'growth.view',
  'dashboard': 'finance.view',
  'business-hub': 'finance.view',
  'task-manager': 'overview.view',
  'ai-insights': 'finance.view',
  'board-report': 'finance.view',
  'exit-plan': 'wealth.view',
  'p4g-ai': 'overview.view',
  'tax': 'intelligence.view',
  'debt': 'intelligence.view',
  'alerts': 'intelligence.view',
  'cashflow': 'finance.view',
  'workbench': 'finance.view',
  'profit': 'finance.view',
  'financial': 'finance.view',
  'payments': 'finance.view',
  'quickbooks': 'finance.view',
  'leakage': 'finance.view',
  'valuation': 'valuation.view',
  'health-setup': 'businesshealth.manage',
  'progress': 'businesshealth.manage',
  'kpiscorecard': 'businesshealth.manage',
  'appointments': 'operations.view',
  'associates': 'operations.view',
  'clinicians': 'operations.view',
  'staff': 'operations.view',
  'pay': 'payrun.manage',
  'chair': 'operations.view',
  'treatments': 'operations.view',
  'uda': 'operations.view',
  'patients': 'growth.view',
  'marketing': 'growth.view',
  'loyalty': 'growth.view',
  'booking': 'growth.view',
  'benchmark': 'growth.view',
  'marketing-overview': 'marketing.view',
  'marketing-channels': 'marketing.view',
  'marketing-campaigns': 'marketing.view',
  'marketing-practices': 'marketing.view',
  'marketing-leads': 'marketing.view',
  // Facebook ad reporting. Same key as the rest of Marketing, so Reception
  // (CRM only, rule 5) never sees it.
  'marketing-facebook': 'marketing.view',
  // Google ad reporting — same key, same reasoning.
  'marketing-google': 'marketing.view',
  'marketing-health': 'marketing.view',
  'crm-today': 'crm.view',
  'inbox': 'crm.view',
  'pipeline': 'crm.view',
  'leads': 'crm.view',
  'crm-enquiries': 'crm.view',
  'contacts': 'crm.view',
  'crm-reports': 'crm.view',
  'ghl-dashboard': 'crm.view',
  'call-reporting': 'growth.view',
  'workflows': 'crm.view',
  'wealth-net': 'wealth.view',
  'wealth-prop': 'wealth.view',
  'wealth-pen': 'wealth.view',
  'training-library': 'training.view',
  'training-my': 'training.view',
  'training-mentorship': 'training.view',
  'training-onetoone': 'training.view',
  'integrations': 'system.manage',
  'data-hub': 'system.manage',
  'team-permissions': 'permissions.manage',
  'settings': 'system.manage',
  'data-summaries': 'data.export',
  'data-dentally': 'data.export',
  'data-google-ads': 'data.export',
  'data-meta-ads': 'data.export',
  'data-gohighlevel': 'data.export',
  'data-emergent': 'data.export',
  'crm-sequences': 'crm.view',
  'crm-templates': 'crm.view',
  'crm-settings': 'crm.manage',
  'pages': 'crm.view',
};

export const PAGE_IDS = Object.keys(PAGE_SECTION);
export const PAGE_PREFIX = 'page:';

/** 'appointments' -> 'page:appointments' */
export const pageKey = (pageId) => PAGE_PREFIX + pageId;

/** 'page:appointments' -> 'appointments'; null for anything else. */
export function pageIdOf(key) {
  if (typeof key !== 'string' || !key.startsWith(PAGE_PREFIX)) return null;
  const id = key.slice(PAGE_PREFIX.length);
  return Object.prototype.hasOwnProperty.call(PAGE_SECTION, id) ? id : null;
}


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
    'overview.view': true,
    'growth.view': true,
    'marketing.view': true,
    'crm.view': true,
    'crm.manage': true,
    'training.view': true,
  },
  reception: {
    'crm.view': true,
    'overview.view': true,
  },
  analyst: {
    'data.export': true,
  },
};

/** True if `key` is a real, grantable permission: a catalog key, or a
 *  `page:<id>` override for a page the nav actually has. */
export function isValidPermission(key) {
  return Object.prototype.hasOwnProperty.call(PERMISSION_CATALOG, key)
    || pageIdOf(key) !== null;
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
  // 5. Page keys. Every page resolves to a value so callers never have to know
  //    whether an override exists: an explicit page:<id> set anywhere in layers
  //    2-4 wins, otherwise the page inherits its section. Written last so an
  //    override cannot be clobbered by the section it belongs to.
  const explicitPages = {};
  for (const row of rolePermissionRows || []) {
    const id = pageIdOf(row.permission_key);
    if (id) explicitPages[id] = !!row.allowed;
  }
  if (userOverrides && typeof userOverrides === 'object') {
    for (const key of Object.keys(userOverrides)) {
      const id = pageIdOf(key);
      if (id) explicitPages[id] = !!userOverrides[key];
    }
  }
  for (const [pageId, sectionKey] of Object.entries(PAGE_SECTION)) {
    effective[pageKey(pageId)] = Object.prototype.hasOwnProperty.call(explicitPages, pageId)
      ? explicitPages[pageId]
      : !!effective[sectionKey];
  }
  return effective;
}

/** Effective access to one page: its override if set, else its section. */
export function canAccessPage(permissions, pageId) {
  const k = pageKey(pageId);
  if (permissions && Object.prototype.hasOwnProperty.call(permissions, k)) return permissions[k] === true;
  const section = PAGE_SECTION[pageId];
  return section ? permissions?.[section] === true : false;
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
  PAGE_SECTION,
  PAGE_IDS,
  pageKey,
  pageIdOf,
  canAccessPage,
  DEFAULT_ROLE_PERMISSIONS,
  isValidPermission,
  resolveEffectivePermissions,
  defaultPermissionsForRole,
};
