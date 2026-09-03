// ============================================================================
// The Operations section is gated on the operations.view PERMISSION, never on
// a role list.
//
// Regression for a live incident: an owner granted `operations.view` to the
// analyst role in the Team Permissions matrix and nothing happened. Four of the
// six Operations routes gated on requireRole('owner','practice_manager'), so a
// permission grant to any other role was decorative and — worse — revoking the
// key from a practice manager was silently ignored. /api/appointments had NO
// user-level gate at all: the nav hid the page, but the API served every
// authenticated user who typed the URL, reception included (CRM-only, rule 5).
//
// These are source-level assertions on purpose. The gate is chosen at module
// load, so the wiring is the thing worth pinning; swapping a key back to a role
// list is exactly the regression this catches.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { requirePermission } from '../src/middleware/auth.js';
import { DEFAULT_ROLE_PERMISSIONS } from '../src/lib/permissions.js';

const ROUTES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'routes');

// Every route file behind an Operations nav item. All of these map to
// operations.view in the frontend's ROUTE_PERMISSION.
const OPERATIONS_ROUTES = [
  'appointments.routes.js',
  'associate.routes.js',
  'staff.routes.js',
  'chair-utilisation.routes.js',
  'treatment.routes.js',
];

// Payroll is inside Operations but deliberately NOT covered by operations.view:
// approving a pay run moves money, so an owner can hand out the rest of the
// section without handing out payroll. Owner-only by default, same as the
// requireRole('owner') it replaced — the point of the key is that the nav can
// hide the tab from anyone who lacks it instead of showing one that 403s.
const PAYROLL_ROUTE = 'pay-runs.routes.js';

const src = (f) => readFileSync(join(ROUTES_DIR, f), 'utf8');

describe('Operations routes gate on the permission, not the role', () => {
  for (const file of OPERATIONS_ROUTES) {
    it(`${file} requires the operations.view permission`, () => {
      expect(src(file)).toMatch(/requirePermission\)?\(\s*'operations\.view'\s*\)/);
    });

    // A role list here re-breaks the matrix: grants to other roles do nothing
    // and revokes from listed roles are ignored.
    it(`${file} does not gate on a hardcoded role list`, () => {
      expect(src(file)).not.toMatch(/requireRole\)?\(\s*'owner'\s*,\s*'practice_manager'\s*\)/);
    });
  }

  it('pay runs require payrun.manage, never the broader operations.view', () => {
    const s = src(PAYROLL_ROUTE);
    expect(s).toMatch(/requirePermission\)?\(\s*'payrun\.manage'\s*\)/);
    expect(s).not.toMatch(/'operations\.view'/);
  });

  it('appointments gates every verb, not just the read', () => {
    const s = src('appointments.routes.js');
    for (const verb of ['get', 'post', 'patch']) {
      expect(s).toMatch(new RegExp(`router\\.${verb}\\('[^']*',\\s*gate,`));
    }
  });
});

describe('requirePermission is what makes a matrix grant real', () => {
  const run = (permissions) => {
    const gate = requirePermission('operations.view');
    let status = null;
    let nexted = false;
    gate(
      { user: permissions === undefined ? undefined : { permissions } },
      { status: (c) => ((status = c), { json: () => {} }) },
      () => { nexted = true; },
    );
    return { status, nexted };
  };

  it('lets through a role the owner granted the key to (analyst)', () => {
    expect(run({ 'operations.view': true })).toEqual({ status: null, nexted: true });
  });

  it('blocks a role without the key (reception is CRM-only, rule 5)', () => {
    expect(run({ 'crm.view': true })).toEqual({ status: 403, nexted: false });
  });

  it('blocks when the owner has REVOKED the key, rather than ignoring the revoke', () => {
    expect(run({ 'operations.view': false })).toEqual({ status: 403, nexted: false });
  });

  it('blocks an unauthenticated request', () => {
    expect(run(undefined)).toEqual({ status: 403, nexted: false });
  });
});

describe('code defaults still back the roles that had access before', () => {
  // The swap from requireRole('owner','practice_manager') to the permission key
  // must not change who gets in by default.
  it('owner and practice_manager hold operations.view by default', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.owner['operations.view']).toBe(true);
    expect(DEFAULT_ROLE_PERMISSIONS.practice_manager['operations.view']).toBe(true);
  });

  it('reception and analyst do not, until an owner grants it', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.reception['operations.view']).toBeFalsy();
    expect(DEFAULT_ROLE_PERMISSIONS.analyst['operations.view']).toBeFalsy();
  });

  it('the analyst keeps data.export by default — its one reason to exist', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.analyst['data.export']).toBe(true);
  });

  it('payrun.manage is owner-only by default, as requireRole(\'owner\') was', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.owner['payrun.manage']).toBe(true);
    for (const role of ['practice_manager', 'reception', 'analyst']) {
      expect(DEFAULT_ROLE_PERMISSIONS[role]['payrun.manage']).toBeFalsy();
    }
  });
});

// ============================================================================
// Overview: nav must name the SAME key the endpoint enforces.
//
// The Overview routes carried no permission key at all, so they showed for
// every role — an analyst granted nothing still saw Daily Cockpit, Command
// Centre, Business Hub, Practice Deep Dive, AI Analyst, Day · Cash Collected,
// Task Manager and Mastermind AI. Six of those are finance surfaces whose
// endpoints already required finance.view, so they rendered and then failed
// with "Insufficient permissions"; the other two were ungated entirely.
// ============================================================================
describe('Overview endpoints are gated, and on the key the nav names', () => {
  const analytics = readFileSync(join(ROUTES_DIR, 'analytics.routes.js'), 'utf8');

  // The frontend maps each of these routes to finance.view; these are the
  // endpoints behind them. If a gate here changes, ROUTE_PERMISSION must move
  // with it or the tab reappears and 403s.
  for (const ep of ['dashboard-summary', 'business-hub', 'practice-summary', 'ai-insights']) {
    it(`/analytics/${ep} requires finance.view`, () => {
      expect(analytics).toMatch(new RegExp(`router\\.get\\('/${ep}',\\s*fin,`));
    });
  }

  it('cockpit (Daily Cockpit, Day · Cash Collected) requires finance.view', () => {
    expect(src('cockpit.routes.js')).toMatch(/requirePermission\)?\(\s*'finance\.view'\s*\)/);
  });

  for (const file of ['p4g-ai.routes.js', 'tasks.routes.js']) {
    it(`${file} is no longer ungated — it requires overview.view`, () => {
      expect(src(file)).toMatch(/requirePermission\)?\(\s*'overview\.view'\s*\)/);
    });
  }

  it('overview.view keeps the roles that could already see those tabs', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.owner['overview.view']).toBe(true);
    expect(DEFAULT_ROLE_PERMISSIONS.practice_manager['overview.view']).toBe(true);
    expect(DEFAULT_ROLE_PERMISSIONS.reception['overview.view']).toBe(true);
  });

  it('the analyst gets NO Overview by default — it must be granted', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.analyst['overview.view']).toBeFalsy();
    expect(DEFAULT_ROLE_PERMISSIONS.analyst['finance.view']).toBeFalsy();
  });
});
