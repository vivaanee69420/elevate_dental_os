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
  { prefix: '/tasks', keys: ['overview.view'] },
  { prefix: '/p4g-ai', keys: ['overview.view'] },
  { prefix: '/cockpit', keys: ['finance.view'] },

  // Finance.
  { prefix: '/monthly-financials', keys: ['finance.view'] },
  { prefix: '/finance/quickbooks', keys: ['finance.view'] },
  { prefix: '/payments', keys: ['finance.view'] },

  // CROSSOVER: Command Centre is a finance.view page and reads the lead funnel
  // and the setup banner (features/dashboard/components/DashboardScreen.tsx),
  // so finance.view has to open these two alongside their own section key.
  // Without it, gating them would break Command Centre for a finance-only user.
  { prefix: '/leads', keys: ['crm.view', 'finance.view'] },
  { prefix: '/health', keys: ['businesshealth.manage', 'finance.view'] },

  // CROSSOVER: Practice Deep Dive is a finance.view page reading /api/growth.
  { prefix: '/growth', keys: ['growth.view', 'finance.view'] },

  { prefix: '/memberships', keys: ['growth.view'] },
  { prefix: '/contacts', keys: ['crm.view'] },
  { prefix: '/comms', keys: ['crm.view'] },
  { prefix: '/workflows', keys: ['crm.view'] },
  { prefix: '/training', keys: ['training.view'] },
  { prefix: '/wealth', keys: ['wealth.view'] },
  { prefix: '/marketing', keys: ['marketing.view'] },
  { prefix: '/debt', keys: ['intelligence.view'] },

  // /analytics is one router serving nearly every section, gated per route on
  // finance/valuation/growth/system. The lock only decides whether the caller
  // belongs to ANY section that reads it; the route's own gate picks the key.
  {
    prefix: '/analytics',
    keys: [
      'finance.view', 'valuation.view', 'growth.view', 'system.manage',
      'crm.view', 'intelligence.view', 'operations.view', 'overview.view',
    ],
  },
];

// Mounts deliberately NOT section-locked, and why. A non-analyst request falls
// through to the router's own gate, so behaviour is unchanged for them;
// analysts are denied by default. Recorded here so the coverage test can tell
// "considered and excluded" apart from "forgotten".
export const UNLISTED_BY_DESIGN = {
  '/integrations': 'Owner/PM role-gated per route, and shared components read it from pages in other sections; locking it on system.manage would 403 those. Needs its own pass.',
  '/imports': 'Owner/PM role-gated; no nav item of its own beyond Data Hub (system.manage).',
  '/crm/templates': 'Owner/PM role-gated; not in nav.',
  '/crm/settings': 'Owner/PM role-gated; not in nav.',
  '/ad-attribution': 'Owner/PM role-gated; nav says growth.view. Real mismatch, left for its own change so the role list is not widened blind.',
  '/call-reporting': 'Owner/PM role-gated; nav says growth.view. Same as above.',
  '/reviews': 'Owner-only; its screen is not wired to a route yet.',
  '/billing': 'Owner-only; no nav item.',
  '/admin/permissions': 'Owner-only by design (grant-ceiling: editing the matrix must not be delegable).',
  '/admin/team': 'Team administration; must stay reachable for an org whose modules are off.',
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
  if (rule) return rule.keys.some((k) => permissions?.[k] === true);

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
