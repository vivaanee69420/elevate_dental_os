// Shared RBAC map — single source of truth for nav-key -> permission key.
//
// Consumed by:
//   - components/layout/sidebar.tsx (nav visibility)
//   - middleware.ts                 (per-route guard)
//
// Permission keys are the fixed backend catalogue returned by GET /auth/me
// .permissions and GET /api/admin/permissions .catalog:
//   finance.view, valuation.view, businesshealth.manage, operations.view,
//   intelligence.view, growth.view, crm.view, crm.manage, wealth.view,
//   training.view, system.manage, users.invite, users.manage,
//   permissions.manage
//
// A route/item is visible only when permissions[key] === true. Overview has
// no key (always visible to any signed-in user). Items that name a more
// specific key (e.g. valuation, team-permissions) override their section.

export type PermissionKey =
  | 'finance.view'
  | 'valuation.view'
  | 'businesshealth.manage'
  | 'operations.view'
  | 'intelligence.view'
  | 'growth.view'
  | 'crm.view'
  | 'crm.manage'
  | 'wealth.view'
  | 'training.view'
  | 'system.manage'
  | 'users.invite'
  | 'users.manage'
  | 'permissions.manage';

export type Permissions = Partial<Record<PermissionKey, boolean>>;

/**
 * Route id (the path segment, no leading slash) -> permission key required to
 * view it. A route absent from this map is treated as Overview-level (always
 * visible to any authenticated user).
 */
export const ROUTE_PERMISSION: Record<string, PermissionKey> = {
  // Overview — intentionally NOT listed (always visible):
  //   dashboard, ai-insights, p4g-ai, mobile

  // Finance
  cashflow: 'finance.view',
  profit: 'finance.view',
  workbench: 'finance.view',
  financial: 'finance.view',
  payments: 'finance.view',
  leakage: 'finance.view',
  quickbooks: 'finance.view',
  'board-report': 'finance.view',
  valuation: 'valuation.view',

  // Business Health
  'health-setup': 'businesshealth.manage',
  progress: 'businesshealth.manage',
  kpiscorecard: 'businesshealth.manage',

  // Operations
  appointments: 'operations.view',
  associates: 'operations.view',
  staff: 'operations.view',
  pay: 'operations.view',
  chair: 'operations.view',
  treatments: 'operations.view',
  uda: 'operations.view',

  // Intelligence
  tax: 'intelligence.view',
  debt: 'intelligence.view',
  alerts: 'intelligence.view',

  // Growth
  patients: 'growth.view',
  marketing: 'growth.view',
  loyalty: 'growth.view',
  booking: 'growth.view',
  benchmark: 'growth.view',
  'ad-performance': 'growth.view',

  // Elevate CRM
  // Call Reporting is a lead-response analytics surface, not a CRM tool —
  // gated on growth.view so Reception (crm.view only, rule 5) never sees it.
  'call-reporting': 'growth.view',

  'crm-today': 'crm.view',
  inbox: 'crm.view',
  pipeline: 'crm.view',
  leads: 'crm.view',
  'crm-enquiries': 'crm.view',
  contacts: 'crm.view',
  'crm-sequences': 'crm.view',
  'crm-templates': 'crm.view',
  'crm-reports': 'crm.view',
  'ghl-dashboard': 'crm.view',
  'crm-settings': 'crm.manage',
  workflows: 'crm.view',
  pages: 'crm.view',

  // Wealth
  'wealth-net': 'wealth.view',
  'wealth-prop': 'wealth.view',
  'wealth-pen': 'wealth.view',
  // Exit Plan moved to the Overview section (boardroom placement), still
  // wealth.view-gated (exposes personal-wealth / sale figures).
  'exit-plan': 'wealth.view',

  // Training
  'training-library': 'training.view',
  'training-my': 'training.view',
  'training-mentorship': 'training.view',
  'training-onetoone': 'training.view',

  // System
  integrations: 'system.manage',
  'data-hub': 'system.manage',
  'team-permissions': 'permissions.manage',
  settings: 'system.manage',
};

/**
 * True when the given route id is visible under the supplied effective
 * permissions. Routes not in the map are Overview-level (always visible).
 * A null/undefined permissions object (e.g. /auth/me failed) yields visible
 * only for unmapped Overview routes.
 */
export function canAccessRoute(
  routeId: string,
  permissions: Permissions | null | undefined,
): boolean {
  const key = ROUTE_PERMISSION[routeId];
  if (!key) return true; // Overview-level
  return permissions?.[key] === true;
}
