// ============================================================================
// Section lock: nav and API must agree, for every role and every section.
//
// The defect class: the nav decided visibility from ROUTE_PERMISSION while each
// router decided access from its own gate, and nothing kept them in step. An
// ungated router served a section the owner had revoked; a role-gated router
// refused a section the owner had granted, which renders a tab that then 403s.
// These tests pin both directions, plus a coverage check so a new mount cannot
// join the API without someone deciding which key opens it.
// ============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  sectionLock, SECTIONS, OPEN, UNLISTED_BY_DESIGN, __test,
} from '../src/middleware/section-lock.js';
import { DEFAULT_ROLE_PERMISSIONS, PERMISSION_KEYS } from '../src/lib/permissions.js';

const { allowed } = __test;
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

// Effective permissions for a built-in role, plus any extra grants an owner
// might make in the Team Permissions matrix.
const perms = (role, extra = {}) => ({ ...DEFAULT_ROLE_PERMISSIONS[role], ...extra });
const can = (role, path, extra = {}, method = 'GET') =>
  allowed(method, path, perms(role, extra), role);

describe('the lock is wired to the permission catalog, not to ad-hoc strings', () => {
  it('every key it references is a real, grantable permission', () => {
    for (const { prefix, keys } of SECTIONS) {
      for (const k of keys) {
        expect(PERMISSION_KEYS, `${prefix} references unknown key ${k}`).toContain(k);
      }
    }
  });
});

describe('coverage: no mount may join /api without a decision about its key', () => {
  // Parse the real mount table out of app.js. A new api.use('/x', ...) that is
  // neither locked nor consciously excluded fails here — which is the whole
  // point: the drift that caused this bug happened silently.
  const app = readFileSync(join(SRC, 'app.js'), 'utf8');
  const mounts = [...app.matchAll(/api\.use\('(\/[\w/-]+)'/g)].map((m) => m[1]);

  it('finds the mount table (guards against this test silently passing)', () => {
    expect(mounts.length).toBeGreaterThan(30);
    expect(mounts).toContain('/appointments');
  });

  it('every mount is either section-locked or recorded as excluded, with a reason', () => {
    const locked = new Set(SECTIONS.map((s) => s.prefix));
    const open = new Set(OPEN.map((s) => s.prefix));
    const undecided = mounts.filter(
      (m) => !locked.has(m) && !open.has(m) && !(m in UNLISTED_BY_DESIGN),
    );
    expect(undecided, `undecided mounts: ${undecided.join(', ')}`).toEqual([]);
  });

  it('every exclusion carries a real reason, not an empty placeholder', () => {
    for (const [mount, why] of Object.entries(UNLISTED_BY_DESIGN)) {
      expect(why.length, `${mount} has no reason`).toBeGreaterThan(20);
    }
  });
});

describe('a grant works and a revoke bites — for every role', () => {
  // The reported bug, generalised: whatever the matrix says must be what the
  // API does, whichever role is asking.
  const cases = [
    ['/appointments', 'operations.view'],
    ['/associates', 'operations.view'],
    ['/pay-runs', 'payrun.manage'],
    ['/data-room', 'data.export'],
    ['/contacts', 'crm.view'],
    ['/training', 'training.view'],
    ['/wealth', 'wealth.view'],
    ['/marketing', 'marketing.view'],
    ['/payments', 'finance.view'],
    ['/tasks', 'overview.view'],
  ];

  for (const role of ['practice_manager', 'reception', 'analyst']) {
    for (const [path, key] of cases) {
      it(`${role}: ${path} follows ${key}`, () => {
        expect(allowed('GET', path, { [key]: true }, role)).toBe(true);
        expect(allowed('GET', path, { [key]: false }, role)).toBe(false);
        expect(allowed('GET', path, {}, role)).toBe(false);
      });
    }
  }

  it('the owner reaches every locked section, holding every key', () => {
    for (const { prefix } of SECTIONS) {
      expect(can('owner', prefix), `owner denied ${prefix}`).toBe(true);
    }
  });
});

describe('no role loses a section its nav already shows it', () => {
  // Locking previously-ungated mounts must not take away anything a role can
  // legitimately see today, or this fix trades one broken tab for another.
  it('practice_manager keeps Operations, Growth, CRM, Marketing and Training', () => {
    for (const p of ['/appointments', '/associates', '/staff', '/chair-utilisation',
      '/treatments', '/growth', '/memberships', '/contacts', '/comms', '/workflows',
      '/leads', '/marketing', '/training', '/tasks', '/p4g-ai']) {
      expect(can('practice_manager', p), `PM denied ${p}`).toBe(true);
    }
  });

  it('reception keeps its CRM essentials and nothing more (rule 5)', () => {
    for (const p of ['/contacts', '/comms', '/leads', '/workflows']) {
      expect(can('reception', p), `reception denied ${p}`).toBe(true);
    }
    for (const p of ['/payments', '/wealth', '/growth', '/training', '/appointments',
      '/pay-runs', '/data-room', '/marketing']) {
      expect(can('reception', p), `reception reached ${p}`).toBe(false);
    }
  });

  it('practice_manager still cannot reach finance, wealth or payroll', () => {
    for (const p of ['/payments', '/monthly-financials', '/finance/quickbooks',
      '/cockpit', '/wealth', '/pay-runs']) {
      expect(can('practice_manager', p), `PM reached ${p}`).toBe(false);
    }
  });
});

describe('cross-section pages keep working', () => {
  // Command Centre is a finance.view page that reads the lead funnel and the
  // setup banner, so locking those on their own section key alone would 403 a
  // finance-only user mid-page.
  it('a finance-only user can still load Command Centre', () => {
    const financeOnly = { 'finance.view': true };
    for (const p of ['/leads', '/health', '/analytics/dashboard-summary']) {
      expect(allowed('GET', p, financeOnly, 'analyst'), `denied ${p}`).toBe(true);
    }
  });

  // /growth carried a finance.view crossover for Practice Deep Dive, the only
  // finance-side reader of it. That page was removed, so the crossover went
  // with it — a crossover outliving its page is how a section quietly widens.
  it('/growth is back to its own key alone, now Deep Dive is gone', () => {
    expect(allowed('GET', '/growth', { 'growth.view': true }, 'analyst')).toBe(true);
    expect(allowed('GET', '/growth', { 'finance.view': true }, 'analyst')).toBe(false);
  });

  it('the CRM and Business Health owners of those routes still reach them', () => {
    expect(allowed('GET', '/leads', { 'crm.view': true }, 'reception')).toBe(true);
    expect(allowed('GET', '/health', { 'businesshealth.manage': true }, 'practice_manager')).toBe(true);
  });

  it('someone with neither key reaches neither', () => {
    expect(allowed('GET', '/leads', { 'training.view': true }, 'reception')).toBe(false);
    expect(allowed('GET', '/health', { 'training.view': true }, 'reception')).toBe(false);
  });
});

describe('shell infrastructure and prefix safety', () => {
  it('practices and notifications stay readable for everyone signed in', () => {
    for (const role of ['owner', 'practice_manager', 'reception', 'analyst']) {
      expect(allowed('GET', '/practices', {}, role)).toBe(true);
      expect(allowed('GET', '/notifications/unread', {}, role)).toBe(true);
    }
  });

  // OPEN covers reads only. A write is not open, but neither is it the lock's
  // call: it falls through to the router, which owner-gates the write. The
  // analyst, being deny-by-default, is stopped here.
  it('writes are not covered by the read exemption', () => {
    expect(allowed('POST', '/practices', {}, 'analyst')).toBe(false);
    expect(allowed('DELETE', '/notifications/1', {}, 'analyst')).toBe(false);
  });

  it('writes fall through for other roles, leaving the router to gate them', () => {
    expect(allowed('POST', '/practices', {}, 'reception')).toBe(true);
  });

  it('longest prefix wins, so /finance/quickbooks is not shadowed', () => {
    expect(allowed('GET', '/finance/quickbooks/status', { 'finance.view': true }, 'analyst')).toBe(true);
    expect(allowed('GET', '/finance/quickbooks/status', { 'crm.view': true }, 'analyst')).toBe(false);
  });

  it('does not match prefix look-alikes', () => {
    const all = { 'operations.view': true, 'data.export': true, 'crm.view': true };
    expect(allowed('GET', '/appointmentsx', all, 'analyst')).toBe(false);
    expect(allowed('GET', '/data-roomx', all, 'analyst')).toBe(false);
    expect(allowed('GET', '/practicesx', all, 'analyst')).toBe(false);
  });
});

describe('unlisted mounts: deny-by-default for the analyst, unchanged for the rest', () => {
  it('the analyst cannot reach a mount nobody has reviewed', () => {
    for (const p of ['/integrations', '/imports', '/billing', '/files', '/ad-attribution']) {
      expect(allowed('GET', p, { 'data.export': true, 'system.manage': true }, 'analyst')).toBe(false);
    }
  });

  it('other roles fall through to the router own gate, so nothing narrows', () => {
    for (const role of ['owner', 'practice_manager', 'reception']) {
      expect(allowed('GET', '/integrations', perms(role), role)).toBe(true);
      expect(allowed('GET', '/files', perms(role), role)).toBe(true);
    }
  });
});

describe('sectionLock middleware', () => {
  let res; let next;
  beforeEach(() => { res = mockRes(); next = vi.fn(); });

  it('passes when there is no req.user (authenticate already answered)', () => {
    sectionLock({ method: 'GET', path: '/contacts' }, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('403s with the standard body, not a leaky one', () => {
    sectionLock(
      { user: { role: 'reception', permissions: perms('reception') }, method: 'GET', path: '/payments' },
      res, next,
    );
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Insufficient permissions' });
  });

  it('lets a granted analyst reach Appointments — the reported bug', () => {
    sectionLock(
      { user: { role: 'analyst', permissions: perms('analyst', { 'operations.view': true }) }, method: 'GET', path: '/appointments' },
      res, next,
    );
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe('the middleware is actually mounted', () => {
  it('app.js wires sectionLock on the /api router', () => {
    const app = readFileSync(join(SRC, 'app.js'), 'utf8');
    expect(app).toMatch(/api\.use\(sectionLock\)/);
  });

  it('the old path-allowlist middleware is gone', () => {
    expect(readdirSync(join(SRC, 'middleware'))).not.toContain('analyst-lock.js');
  });
});
