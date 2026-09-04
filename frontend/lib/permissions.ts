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
//   permissions.manage, data.export, payrun.manage, overview.view
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
  | 'overview.view'
  | 'intelligence.view'
  | 'growth.view'
  | 'marketing.view'
  | 'crm.view'
  | 'crm.manage'
  | 'wealth.view'
  | 'training.view'
  | 'system.manage'
  | 'users.invite'
  | 'users.manage'
  | 'permissions.manage'
  | 'data.export'
  | 'payrun.manage';

export type Permissions = Partial<Record<PermissionKey, boolean>>;

/**
 * Route id (the path segment, no leading slash) -> permission key required to
 * view it. A route absent from this map is treated as Overview-level (always
 * visible to any authenticated user).
 */
export const ROUTE_PERMISSION: Record<string, PermissionKey> = {
  // Overview. These used to be absent from this map, which made them visible
  // to EVERY role — including an analyst who had been granted nothing. Six of
  // them are finance surfaces: /analytics/dashboard-summary, business-hub,
  // practice-summary, ai-insights and /api/cockpit are all requirePermission
  // ('finance.view') on the backend, so naming any other key here would put a
  // tab in the nav that 403s the moment it is opened.
  cockpit: 'finance.view',
  dashboard: 'finance.view',
  'business-hub': 'finance.view',
  'ai-insights': 'finance.view',
  // The two Overview tabs that are not finance surfaces.
  'task-manager': 'overview.view',
  'p4g-ai': 'overview.view',

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
  // Was unmapped, so it showed to every role including reception (CRM-only).
  clinicians: 'operations.view',
  staff: 'operations.view',
  // Payroll has its own key: approving a pay run moves money, so it is not
  // bundled into operations.view. Owner-only by default.
  pay: 'payrun.manage',
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

  // Marketing — its own dedicated key (not growth.view): Task 7 registered
  // marketing.view specifically so Reception (crm.view only, rule 5) never
  // gets it by default while an owner can still grant/revoke it independently
  // of Growth via the Team Permissions matrix.
  'marketing-overview': 'marketing.view',
  'marketing-campaigns': 'marketing.view',
  'marketing-facebook': 'marketing.view',
  'marketing-google': 'marketing.view',
  'marketing-channels': 'marketing.view',
  'marketing-practices': 'marketing.view',
  'marketing-leads': 'marketing.view',
  'marketing-health': 'marketing.view',

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

/**
 * Nav SECTION label -> module feature key (agency model, phase A3). Backend
 * enforcement is `requireFeature` on the section's own route mounts; this
 * mirrors it in nav. Overview has no key by design (it is the always-on home
 * section) and Data Room is gated per-item via ROUTE_FEATURE above.
 */
export const SECTION_FEATURE: Record<string, string> = {
  Finance: 'finance',
  'Business Health': 'business_health',
  Operations: 'operations',
  Growth: 'growth',
  Marketing: 'marketing',
  'Elevate CRM': 'crm',
  Wealth: 'wealth',
  Training: 'training',
  // Keyed by the nav LABEL, which is now 'Settings'; the feature key stays
  // 'system' because that is the backend module name, not a display string.
  Settings: 'system',
};

/** As featureAllowsRoute, but for a whole nav section. */
export function featureAllowsSection(
  sectionLabel: string,
  features: string[] | undefined | null,
): boolean {
  const key = SECTION_FEATURE[sectionLabel];
  if (!key) return true;
  if (features === undefined || features === null) return true;
  return features.includes(key);
}

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
/**
 * Pages whose API endpoint belongs to them alone, so a per-page override is
 * enforced by the backend and not merely hidden in the nav. Mirrors PAGE_OWNED
 * in backend/src/middleware/section-lock.js.
 *
 * Every other page shares one endpoint with the rest of its section (Finance's
 * screens all read /api/analytics, Growth's all read /api/growth, Training's
 * all read /api/training), so the API cannot tell them apart. Turning one of
 * those off hides the page; it does not block the data. The matrix labels them
 * "nav only" rather than implying a boundary that is not there.
 */
export const PAGE_ENFORCED = new Set([
  'appointments', 'associates', 'staff', 'chair', 'treatments', 'pay',
  'contacts', 'inbox', 'workflows', 'task-manager', 'p4g-ai', 'cockpit',
]);

/** 'appointments' -> 'page:appointments' (the per-page override key). */
export const pageKey = (routeId: string) => `page:${routeId}`;

export function canAccessRoute(
  routeId: string,
  permissions: Permissions | null | undefined,
): boolean {
  const key = ROUTE_PERMISSION[routeId];
  if (!key) return true; // Overview-level
  // Two-level: an explicit per-page override wins over the section it belongs
  // to. The backend resolves a page:<id> value for every page, so this is
  // normally just a lookup; the section fallback covers an older backend that
  // does not send page keys yet.
  const override = (permissions as Record<string, boolean> | null | undefined)?.[pageKey(routeId)];
  if (typeof override === 'boolean') return override;
  return permissions?.[key] === true;
}

/**
 * Nav sections (with their items already filtered) visible to a user.
 *
 * Every role, analyst included, is driven purely by its effective permissions.
 * The analyst used to be hard-coded here to Data Room routes and nothing else,
 * which made the Team Permissions matrix inert for that role: an owner could
 * grant operations.view to an analyst and nothing appeared, because the grant
 * was filtered out before canAccessRoute ever saw it. Access is the matrix's
 * job — if a role should not reach a section, revoke the key.
 *
 * Overview items carry no permission key and so remain visible to every role
 * (Business Hub included). That is the existing product decision, not an
 * analyst special case: give a section a key in ROUTE_PERMISSION and it
 * becomes revocable here for everyone.
 */
export function visibleNavSections(
  role: string | undefined,
  permissions: Permissions | null | undefined,
  features?: string[] | null,
): NavSection[] {
  const out: NavSection[] = [];
  for (const section of NAV) {
    // A module the org does not have hides its whole section.
    if (!featureAllowsSection(section.label, features)) continue;
    const items = section.items.filter(
      (i) => canAccessRoute(i.id, permissions) && featureAllowsRoute(i.id, features),
    );
    if (items.length > 0) out.push({ ...section, items });
  }
  return out;
}

/** Flat list of the route ids a user may open, in nav order. */
export function accessibleRouteIds(
  role: string | undefined,
  permissions: Permissions | null | undefined,
  features?: string[] | null,
): string[] {
  return visibleNavSections(role, permissions, features).flatMap((s) =>
    s.items.map((i) => i.id),
  );
}
