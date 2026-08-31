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
//   permissions.manage, data.export
//
// A route/item is visible only when permissions[key] === true. Overview has
// no key (always visible to any signed-in user). Items that name a more
// specific key (e.g. valuation, team-permissions) override their section.

import { NAV, type NavSection } from './nav';

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
  | 'permissions.manage'
  | 'data.export';

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

  // Data Room — raw source rows for the analyst role (owner also holds the key)
  'data-summaries': 'data.export',
  'data-dentally': 'data.export',
  'data-google-ads': 'data.export',
  'data-meta-ads': 'data.export',
  'data-gohighlevel': 'data.export',
  'data-emergent': 'data.export',
};

/**
 * Route ids that additionally require an org-level feature (agency model).
 * Enforcement lives in the backend (requireFeature); this only mirrors it in
 * nav. `features === undefined` (backend without the field yet) allows —
 * the API stays the boundary.
 */
export const ROUTE_FEATURE: Record<string, string> = {
  'call-reporting': 'call_reporting',
  'data-summaries': 'data_room',
  'data-dentally': 'data_room',
  'data-google-ads': 'data_room',
  'data-meta-ads': 'data_room',
  'data-gohighlevel': 'data_room',
  'data-emergent': 'data_room',
};

export function featureAllowsRoute(
  routeId: string,
  features: string[] | undefined | null,
): boolean {
  const key = ROUTE_FEATURE[routeId];
  if (!key) return true;
  if (features === undefined || features === null) return true;
  return features.includes(key);
}

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

/** The six Data Room route ids — the ONLY routes an analyst may see. */
export const DATA_ROOM_ROUTES = [
  'data-summaries',
  'data-dentally',
  'data-google-ads',
  'data-meta-ads',
  'data-gohighlevel',
  'data-emergent',
] as const;

export function isDataRoomRoute(routeId: string): boolean {
  return (DATA_ROOM_ROUTES as readonly string[]).includes(routeId);
}

/**
 * Nav sections (with their items already filtered) visible to a user.
 * Overview items have no permission key and normally show for everyone, so
 * the `analyst` role is handled explicitly: it sees the Data Room section and
 * nothing else. Every other role gets the per-item canAccessRoute filter.
 */
export function visibleNavSections(
  role: string | undefined,
  permissions: Permissions | null | undefined,
  features?: string[] | null,
): NavSection[] {
  const out: NavSection[] = [];
  for (const section of NAV) {
    const items = section.items.filter((i) =>
      (role === 'analyst'
        ? isDataRoomRoute(i.id) && canAccessRoute(i.id, permissions)
        : canAccessRoute(i.id, permissions)) && featureAllowsRoute(i.id, features),
    );
    if (items.length > 0) out.push({ ...section, items });
  }
  return out;
}
