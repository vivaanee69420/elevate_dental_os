// ============================================================================
// Section lock — one place where "which permission does this API area need"
// is answered, enforced for EVERY role.
//
// THE BUG THIS EXISTS TO PREVENT: the nav decides what a user can see from
// frontend lib/permissions.ts ROUTE_PERMISSION, and each router decided what a
// user could actually fetch from its own gate. Nothing kept the two in step, so
// they drifted in both directions:
//
//   * a router with NO gate (/health, /leads, /payments, /growth, /training,
//     /contacts, /comms, /workflows) served every signed-in user, so revoking
//     the section only hid the tab — the data stayed reachable by URL;
//   * a router gated on a ROLE LIST answered "no" to a user the matrix had
//     said "yes" to, which is a tab that renders and then fails. That is
//     exactly how an analyst granted operations.view still got
//     "Insufficient permissions" on every Operations request.
//
// So the mapping lives HERE, once, mirroring ROUTE_PERMISSION, and the routers
// keep their own gates as defence in depth. A prefix opens when the caller
// holds ANY ONE of its keys; the router's gate then decides the specific
// route. Several keys per prefix is not laxity — it is how a page that
// legitimately reads across sections keeps working (see the crossovers below).
//
// ADDING A MOUNT: list it here with the same key its nav item uses in
// ROUTE_PERMISSION. test/section-lock.test.mjs fails if a mount is neither
// listed nor recorded in UNLISTED_BY_DESIGN, so this cannot silently drift.
// ============================================================================

import { canAccessPage } from '../lib/permissions.js';

// Prefixes owned by exactly ONE nav page. These are the mounts where a
// per-page override can be enforced for real, not merely hidden in the nav:
// the request itself identifies the page. Everything else stays section-level
// because several pages share the endpoint and the API cannot tell them apart.
export const PAGE_OWNED = {
  '/appointments': 'appointments',
  '/associates': 'associates',
  '/staff': 'staff',
  // NOT page-owned any more. This mount now serves THREE nav pages - Chair
  // Utilisation, Practitioner Performance and Practitioner Schedules - so no
  // request on it identifies a single page, and a per-page override could not
  // be enforced honestly. It falls through to the section rule below, which is
  // what a shared mount is entitled to. (It was owned by the manual chair
  // entry page, which is retired.)
  '/treatments': 'treatments',
  '/pay-runs': 'pay',
  '/contacts': 'contacts',
  '/comms': 'inbox',
  '/workflows': 'workflows',
  '/tasks': 'task-manager',
  '/p4g-ai': 'p4g-ai',
  '/cockpit': 'cockpit',
};

// Infrastructure every signed-in user needs regardless of section: the app
// shell cannot render without it, and it carries no section data.
export const OPEN = [
  { prefix: '/practices', methods: ['GET', 'HEAD'] },     // practice pickers/filters
  { prefix: '/notifications', methods: ['GET', 'HEAD'] }, // topbar bell
];

// prefix -> keys that open it (ANY one is enough).
export const SECTIONS = [
  { prefix: '/data-room', keys: ['data.export'] },

  // Operations. Payroll is deliberately NOT operations.view: approving a pay
  // run moves money, so it carries its own key.
  { prefix: '/appointments', keys: ['operations.view'] },
  { prefix: '/associates', keys: ['operations.view'] },
  { prefix: '/staff', keys: ['operations.view'] },
  { prefix: '/chair-utilisation', keys: ['operations.view'] },
  { prefix: '/treatments', keys: ['operations.view'] },
  { prefix: '/pay-runs', keys: ['payrun.manage'] },

  // Overview.
  { prefix: '/tasks', keys: ['overview.view', 'tasks.manage'] },
  { prefix: '/p4g-ai', keys: ['overview.view'] },
  { prefix: '/cockpit', keys: ['finance.view', 'finance.edit'] },

  // Finance.
  { prefix: '/monthly-financials', keys: ['finance.view'] },
  { prefix: '/finance/quickbooks', keys: ['finance.view'] },
  { prefix: '/payments', keys: ['finance.view'] },
  // Tax reads the same revenue and profit the P&L does, so it takes the same
  // key — Reception is CRM-only (rule 5) and must never see a tax position.
  // Its WRITES carry tax.manage at the route: entity type and VAT liability
  // are declarations about the business, not a finance viewer's call — but
  // "not a finance viewer's call" is a permission, not a role, so an owner can
  // hand it to whoever actually files the returns.
  { prefix: '/tax', keys: ['finance.view', 'tax.manage'] },

  // CROSSOVER: Command Centre is a finance.view page and reads the lead funnel
  // and the setup banner (features/dashboard/components/DashboardScreen.tsx),
  // so finance.view has to open these two alongside their own section key.
  // Without it, gating them would break Command Centre for a finance-only user.
  // data.export is here because /leads/export.csv requires it and the ANALYST
  // is the person that key exists for. Without it the mount refused them
  // before the route could allow them — a gate nobody could pass, which is a
  // worse failure than a missing one because the route reads as if it works.
  { prefix: '/leads', keys: ['crm.view', 'finance.view', 'data.export'] },
  { prefix: '/health', keys: ['businesshealth.manage', 'finance.view'] },

  // finance.view used to open this too, for Practice Deep Dive — the only
  // finance-side reader of /api/growth. That page has been removed, so the
  // crossover is gone and /growth is back to its own section key alone.
  { prefix: '/growth', keys: ['growth.view'] },

  { prefix: '/memberships', keys: ['growth.view'] },
  // Review SOURCE administration is growth.manage, the write half of
  // growth.view. It was owner-only by role, which made "who looks after our
  // Google reviews" undelegable.
  { prefix: '/reviews', keys: ['growth.view', 'growth.manage'] },
  { prefix: '/contacts', keys: ['crm.view'] },
  { prefix: '/comms', keys: ['crm.view'] },
  { prefix: '/workflows', keys: ['crm.view'] },
  { prefix: '/training', keys: ['training.view'] },
  { prefix: '/wealth', keys: ['wealth.view', 'wealth.edit'] },
  { prefix: '/marketing', keys: ['marketing.view', 'marketing.manage'] },
  { prefix: '/debt', keys: ['intelligence.view'] },

  // Settings, and the endpoints other sections legitimately read from it.
  // These four were in UNLISTED_BY_DESIGN as "role-gated per route, needs its
  // own pass" — that pass is this change: every route below now carries a
  // permission gate naming the same key its nav item does, so the mount can be
  // locked without the two contradicting each other.
  //
  // /integrations is several keys because it is genuinely read from outside
  // Settings: Call Reporting reads google-sheets status (growth.view), the GHL
  // dashboard reads gohighlevel/dashboard (crm.view), Finance reads the
  // QuickBooks account list (finance.view), and the Marketing pages read ad
  // accounts (marketing.view). One key would 403 a page that has every right
  // to the data; the ROUTE's own gate still picks the specific key.
  {
    prefix: '/integrations',
    keys: ['system.manage', 'growth.view', 'crm.view', 'finance.view', 'marketing.view'],
  },
  { prefix: '/imports', keys: ['system.manage'] },
  // Team administration. Locked on the keys its own routes require and its nav
  // item names — all three used to disagree. Deliberately NOT module-gated
  // elsewhere: an organisation with every module switched off must still be
  // able to administer its own people.
  { prefix: '/admin/team', keys: ['users.manage', 'users.invite'] },
  { prefix: '/crm/templates', keys: ['crm.manage'] },
  { prefix: '/crm/settings', keys: ['crm.manage'] },
  { prefix: '/call-reporting', keys: ['growth.view'] },
  { prefix: '/ad-attribution', keys: ['marketing.view', 'growth.view'] },

  // /analytics is one router serving nearly every section, gated per route on
  // finance/valuation/growth/system. The lock only decides whether the caller
  // belongs to ANY section that reads it; the route's own gate picks the key.
  {
    prefix: '/analytics',
    keys: [
      'finance.view', 'valuation.view', 'growth.view', 'system.manage',
      'crm.view', 'intelligence.view', 'operations.view', 'overview.view',
      // The EDIT keys, because routes in here require them: a person granted
      // finance.edit or valuation.edit without the matching .view was refused
      // at the mount and never reached the route that would have let them in.
      'finance.edit', 'valuation.edit',
    ],
  },
];

// Mounts deliberately NOT section-locked, and why. A non-analyst request falls
// through to the router's own gate, so behaviour is unchanged for them;
// analysts are denied by default. Recorded here so the coverage test can tell
// "considered and excluded" apart from "forgotten".
export const UNLISTED_BY_DESIGN = {
  '/billing': 'system.manage at the route; no nav item of its own, so there is no nav key to mirror.',
  '/admin/permissions': 'Owner-only by design (grant-ceiling: editing the matrix must not be delegable).',
  '/admin/logs': 'Agency-actor only; process-wide log files carry every tenant\'s data.',
  '/agency': 'Agency-actor only, gated inside the router.',
  '/files': 'Upload/download used from many sections; no single owning key.',
  '/practices': 'Reads are OPEN above (every section needs the picker); writes are owner-gated in the router.',
  '/notifications': 'Reads are OPEN above; writes are per-user.',
  '/health-business': 'Alias of /health, already listed.',
};

function matches(path, prefix) {
  return path === prefix || path.startsWith(prefix + '/') || path.startsWith(prefix + '?');
}

function allowed(method, path, permissions, role) {
  if (OPEN.some((r) => matches(path, r.prefix) && (!r.methods || r.methods.includes(method)))) {
    return true;
  }
  // Longest prefix wins, so /finance/quickbooks is not shadowed by a shorter one.
  const rule = SECTIONS
    .filter((r) => matches(path, r.prefix))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0];
  if (rule) {
    // A prefix owned by one page follows that page, so an owner who grants the
    // section but switches this page off is obeyed by the API and not just by
    // the nav. canAccessPage falls back to the section when no override is set.
    const pageId = PAGE_OWNED[rule.prefix];
    if (pageId) return canAccessPage(permissions, pageId);
    return rule.keys.some((k) => permissions?.[k] === true);
  }

  // Unlisted. The analyst is a scoped, often external account and several
  // routers still carry no gate of their own, so it stays deny-by-default.
  // Every other role falls through to the router's gate — this middleware
  // must never quietly widen or narrow them on a mount nobody has reviewed.
  return role !== 'analyst';
}

export function sectionLock(req, res, next) {
  // authenticate runs first; no user here means it already answered.
  if (!req.user) return next();
  // req.path is relative to the /api mount and excludes the query string.
  if (allowed(req.method, req.path, req.user.permissions, req.user.role)) return next();
  return res.status(403).json({ error: 'Insufficient permissions' });
}

export const __test = { allowed, matches };
