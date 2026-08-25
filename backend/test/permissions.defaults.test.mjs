// ============================================================================
// Permanent-fix coverage: CODE role defaults are the safety net.
// Pure (no DB) — proves an owner is never locked out when role_permissions
// is empty/missing, and that DB rows + user overrides still layer on top.
// ============================================================================
import { describe, it, expect } from 'vitest';
import pkg from '../src/lib/permissions.js';

const {
  PERMISSION_KEYS,
  DEFAULT_ROLE_PERMISSIONS,
  resolveEffectivePermissions,
  defaultPermissionsForRole,
} = pkg;

describe('code role defaults (no DB rows)', () => {
  it('owner gets every permission with empty rows', () => {
    const eff = resolveEffectivePermissions([], {}, 'owner');
    for (const k of PERMISSION_KEYS) expect(eff[k]).toBe(true);
  });

  it('reception gets only crm.view with empty rows', () => {
    const eff = resolveEffectivePermissions([], {}, 'reception');
    expect(eff['crm.view']).toBe(true);
    expect(eff['finance.view']).toBe(false);
    expect(eff['permissions.manage']).toBe(false);
  });

  it('practice_manager gets ops/growth/crm/training, not finance/wealth', () => {
    const eff = resolveEffectivePermissions([], {}, 'practice_manager');
    expect(eff['operations.view']).toBe(true);
    expect(eff['crm.manage']).toBe(true);
    expect(eff['training.view']).toBe(true);
    expect(eff['finance.view']).toBe(false);
    expect(eff['wealth.view']).toBe(false);
    expect(eff['system.manage']).toBe(false);
  });

  it('no role supplied -> legacy deny-all base (back-compat)', () => {
    const eff = resolveEffectivePermissions([], {});
    for (const k of PERMISSION_KEYS) expect(eff[k]).toBe(false);
  });

  it('analyst gets ONLY data.export with empty rows', () => {
    const eff = resolveEffectivePermissions([], {}, 'analyst');
    expect(eff['data.export']).toBe(true);
    for (const k of PERMISSION_KEYS) {
      if (k !== 'data.export') expect(eff[k]).toBe(false);
    }
  });

  it('owner and only owner holds data.export by default', () => {
    expect(resolveEffectivePermissions([], {}, 'owner')['data.export']).toBe(true);
    expect(resolveEffectivePermissions([], {}, 'practice_manager')['data.export']).toBe(false);
    expect(resolveEffectivePermissions([], {}, 'reception')['data.export']).toBe(false);
  });
});

describe('layering on top of code defaults', () => {
  it('DB row can REVOKE a code default for the role', () => {
    const eff = resolveEffectivePermissions(
      [{ permission_key: 'crm.view', allowed: false }],
      {},
      'reception',
    );
    expect(eff['crm.view']).toBe(false); // code default true, DB overrides off
  });

  it('DB row can GRANT a non-default for the role', () => {
    const eff = resolveEffectivePermissions(
      [{ permission_key: 'finance.view', allowed: true }],
      {},
      'practice_manager',
    );
    expect(eff['finance.view']).toBe(true);
  });

  it('per-user override beats both code default and DB row', () => {
    const eff = resolveEffectivePermissions(
      [{ permission_key: 'finance.view', allowed: true }],
      { 'finance.view': false },
      'owner',
    );
    expect(eff['finance.view']).toBe(false);
  });
});

describe('defaultPermissionsForRole (fail-safe fallback)', () => {
  it('owner fallback = full access (auth.js DB-failure path)', () => {
    const eff = defaultPermissionsForRole('owner', undefined);
    for (const k of PERMISSION_KEYS) expect(eff[k]).toBe(true);
  });

  it('unknown role fallback = deny-all (safe)', () => {
    const eff = defaultPermissionsForRole('ghost', {});
    for (const k of PERMISSION_KEYS) expect(eff[k]).toBe(false);
  });

  it('DEFAULT_ROLE_PERMISSIONS.owner covers every catalog key', () => {
    for (const k of PERMISSION_KEYS) {
      expect(DEFAULT_ROLE_PERMISSIONS.owner[k]).toBe(true);
    }
  });
});
