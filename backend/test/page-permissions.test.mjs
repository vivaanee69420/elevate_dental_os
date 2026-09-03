// ============================================================================
// Two-level grants: a section key is the default for its pages, and a
// `page:<id>` key overrides it for one page.
//
// The point is that an owner can hand out a single page instead of a whole
// section. The risk is silence: a page the backend does not know about would
// fall back to its section and ignore the override without erroring, so the
// first test here reads the frontend's own map and fails on any drift.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  PAGE_SECTION, PAGE_IDS, pageKey, pageIdOf, canAccessPage,
  isValidPermission, resolveEffectivePermissions, PERMISSION_KEYS,
} from '../src/lib/permissions.js';
import { PAGE_OWNED, __test } from '../src/middleware/section-lock.js';

const { allowed } = __test;
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('the page map matches the nav it mirrors', () => {
  // frontend/lib/permissions.ts ROUTE_PERMISSION is what the sidebar reads.
  const fe = readFileSync(join(REPO, 'frontend', 'lib', 'permissions.ts'), 'utf8');
  const block = fe.split('export const ROUTE_PERMISSION')[1].split('\n};')[0];
  const frontend = Object.fromEntries(
    [...block.matchAll(/^\s*'?([\w-]+)'?\s*:\s*'([\w.]+)',/gm)].map((m) => [m[1], m[2]]),
  );

  it('parses the frontend map (guards against this test passing on nothing)', () => {
    expect(Object.keys(frontend).length).toBeGreaterThan(50);
    expect(frontend.appointments).toBe('operations.view');
  });

  it('covers exactly the same pages', () => {
    expect(Object.keys(PAGE_SECTION).sort()).toEqual(Object.keys(frontend).sort());
  });

  it('agrees on which section each page belongs to', () => {
    for (const [page, key] of Object.entries(frontend)) {
      expect(PAGE_SECTION[page], `${page} disagrees`).toBe(key);
    }
  });

  it('every section a page points at is a real permission key', () => {
    for (const [page, key] of Object.entries(PAGE_SECTION)) {
      expect(PERMISSION_KEYS, `${page} -> unknown key ${key}`).toContain(key);
    }
  });
});

describe('page keys are grantable, junk is not', () => {
  it('accepts page keys for pages that exist', () => {
    expect(isValidPermission('page:appointments')).toBe(true);
    expect(isValidPermission('page:data-dentally')).toBe(true);
  });

  it('rejects page keys for pages that do not', () => {
    expect(isValidPermission('page:not-a-page')).toBe(false);
    expect(isValidPermission('page:')).toBe(false);
    expect(pageIdOf('page:not-a-page')).toBeNull();
    expect(pageIdOf('operations.view')).toBeNull();
  });

  it('round-trips a page id', () => {
    for (const id of PAGE_IDS) expect(pageIdOf(pageKey(id))).toBe(id);
  });
});

describe('a page inherits its section until it is overridden', () => {
  const resolve = (rows, overrides = {}) => resolveEffectivePermissions(rows, overrides, 'analyst');

  it('granting the section grants every page under it — unchanged behaviour', () => {
    const eff = resolve([{ permission_key: 'operations.view', allowed: true }]);
    for (const page of ['appointments', 'associates', 'staff', 'chair', 'treatments', 'uda']) {
      expect(eff[pageKey(page)], `${page} did not inherit`).toBe(true);
    }
  });

  it('a page override switches ONE page off inside a granted section', () => {
    const eff = resolve([
      { permission_key: 'operations.view', allowed: true },
      { permission_key: 'page:associates', allowed: false },
    ]);
    expect(eff['operations.view']).toBe(true);
    expect(eff[pageKey('appointments')]).toBe(true);
    expect(eff[pageKey('associates')]).toBe(false);
  });

  it('a page override switches ONE page on inside a section that is off', () => {
    const eff = resolve([{ permission_key: 'page:appointments', allowed: true }]);
    expect(eff['operations.view']).toBe(false);
    expect(eff[pageKey('appointments')]).toBe(true);
    expect(eff[pageKey('associates')]).toBe(false);
  });

  it('a per-user override beats the role-level page override', () => {
    const eff = resolve(
      [{ permission_key: 'page:appointments', allowed: false }],
      { 'page:appointments': true },
    );
    expect(eff[pageKey('appointments')]).toBe(true);
  });

  it('every page resolves to a boolean, so callers never see undefined', () => {
    const eff = resolve([]);
    for (const id of PAGE_IDS) expect(typeof eff[pageKey(id)]).toBe('boolean');
  });

  it('canAccessPage reads the override, then falls back to the section', () => {
    expect(canAccessPage({ 'operations.view': true }, 'appointments')).toBe(true);
    expect(canAccessPage({ 'operations.view': true, 'page:appointments': false }, 'appointments')).toBe(false);
    expect(canAccessPage({ 'operations.view': false, 'page:appointments': true }, 'appointments')).toBe(true);
    expect(canAccessPage({}, 'not-a-page')).toBe(false);
  });
});

describe('the API enforces an override where the page owns its endpoint', () => {
  it('every PAGE_OWNED entry names a page that exists', () => {
    for (const [prefix, page] of Object.entries(PAGE_OWNED)) {
      expect(PAGE_IDS, `${prefix} -> unknown page ${page}`).toContain(page);
    }
  });

  it('turning off one page closes its endpoint while the section stays open', () => {
    const perms = resolveEffectivePermissions(
      [{ permission_key: 'operations.view', allowed: true },
        { permission_key: 'page:associates', allowed: false }],
      {}, 'analyst',
    );
    expect(allowed('GET', '/appointments', perms, 'analyst')).toBe(true);
    expect(allowed('GET', '/associates', perms, 'analyst')).toBe(false);
    // The rest of the section is untouched.
    expect(allowed('GET', '/staff', perms, 'analyst')).toBe(true);
  });

  it('turning ON one page opens only that endpoint', () => {
    const perms = resolveEffectivePermissions(
      [{ permission_key: 'page:appointments', allowed: true }], {}, 'analyst',
    );
    expect(allowed('GET', '/appointments', perms, 'analyst')).toBe(true);
    expect(allowed('GET', '/associates', perms, 'analyst')).toBe(false);
    expect(allowed('GET', '/staff', perms, 'analyst')).toBe(false);
  });

  it('a shared endpoint still follows the section — nav-only, and honestly so', () => {
    // Growth's pages all read /api/growth, so switching one off cannot close
    // the endpoint. The matrix marks these "nav only" rather than pretending.
    const perms = resolveEffectivePermissions(
      [{ permission_key: 'growth.view', allowed: true },
        { permission_key: 'page:loyalty', allowed: false }],
      {}, 'analyst',
    );
    expect(perms[pageKey('loyalty')]).toBe(false);   // hidden in nav
    expect(allowed('GET', '/growth', perms, 'analyst')).toBe(true); // endpoint stays open
  });
});
