// ============================================================================
// Analyst API lock. Deny-by-default net for the `analyst` role, mounted on the
// /api router immediately after authenticate (before audit).
//
// WHY IT EXISTS: several legacy feature routers under /api carry no
// requirePermission gate of their own, so hiding a page in the nav is not a
// boundary. For a scoped, often external account that is not good enough, so
// an analyst is denied everything except what is listed here.
//
// WHY IT IS PERMISSION-AWARE: it used to be a flat path allowlist
// (/data-room, /practices, /notifications) that ignored the Team Permissions
// matrix completely. An owner could grant an analyst `operations.view`, watch
// the tab appear in the nav, and every request behind it still returned
// "Insufficient permissions" — the grant was unreachable, and nothing in the
// permissions code explained why. A prefix now opens only when the analyst
// actually holds one of the keys listed for it, so a grant works and a revoke
// bites, while anything unlisted stays denied.
//
// ADDING A PREFIX: only list a router that carries its OWN requirePermission
// gate. This lock decides "may an analyst reach this area at all"; the
// router's own gate is what enforces the specific key per route. Listing an
// ungated router would hand analysts the very hole this middleware exists to
// close.
// ============================================================================

// Unconditional reads: infrastructure the shell needs on every page, carrying
// no tenant business data beyond names the analyst can already see.
const ALLOW = [
  { prefix: '/practices', methods: ['GET', 'HEAD'] },     // practice pills / filters
  { prefix: '/notifications', methods: ['GET', 'HEAD'] }, // topbar bell
];

// prefix -> the keys that open it. Holding ANY ONE is enough to pass this
// lock; the router's own per-route gate then decides the specific request.
const PERMITTED = [
  { prefix: '/data-room', keys: ['data.export'] },

  // Operations. Every one of these routers gates on operations.view itself,
  // except pay-runs which gates on payrun.manage (payroll moves money, so it
  // is deliberately not covered by operations.view).
  { prefix: '/appointments', keys: ['operations.view'] },
  { prefix: '/associates', keys: ['operations.view'] },
  { prefix: '/staff', keys: ['operations.view'] },
  { prefix: '/chair-utilisation', keys: ['operations.view'] },
  { prefix: '/treatments', keys: ['operations.view'] },
  { prefix: '/pay-runs', keys: ['payrun.manage'] },

  // Overview. /tasks and /p4g-ai gate on overview.view; /analytics and
  // /cockpit gate per-route on finance/valuation/growth/system, so any of
  // those keys gets past this lock and the route picks the right one.
  { prefix: '/tasks', keys: ['overview.view'] },
  { prefix: '/p4g-ai', keys: ['overview.view'] },
  {
    prefix: '/analytics',
    keys: ['finance.view', 'valuation.view', 'growth.view', 'system.manage'],
  },
  { prefix: '/cockpit', keys: ['finance.view'] },

  // Finance surfaces with their own requirePermission gates.
  { prefix: '/monthly-financials', keys: ['finance.view'] },
  { prefix: '/finance/quickbooks', keys: ['finance.view'] },
  { prefix: '/wealth', keys: ['wealth.view'] },
  { prefix: '/marketing', keys: ['marketing.view'] },
];

function matches(path, prefix) {
  return path === prefix || path.startsWith(prefix + '/') || path.startsWith(prefix + '?');
}

function allowed(method, path, permissions) {
  if (ALLOW.some((r) => matches(path, r.prefix) && (!r.methods || r.methods.includes(method)))) {
    return true;
  }
  return PERMITTED.some(
    (r) => matches(path, r.prefix) && r.keys.some((k) => permissions?.[k] === true),
  );
}

export function analystLock(req, res, next) {
  if (req.user?.role !== 'analyst') return next();
  // req.path is relative to the router mount (/api) and excludes the query string.
  if (allowed(req.method, req.path, req.user?.permissions)) return next();
  return res.status(403).json({ error: 'Insufficient permissions' });
}

export const __test = { allowed };
