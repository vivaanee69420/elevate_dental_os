import { describe, it, expect } from 'vitest';
import pkg from '../src/lib/permissions.js';

const {
  PERMISSION_CATALOG,
  PERMISSION_KEYS,
  isValidPermission,
  resolveEffectivePermissions,
} = pkg;

describe('isValidPermission', () => {
  it('is true for every catalog key', () => {
    for (const key of PERMISSION_KEYS) {
      expect(isValidPermission(key)).toBe(true);
    }
  });

  it('is false for unknown / non-string keys', () => {
    expect(isValidPermission('not.a.real.permission')).toBe(false);
    expect(isValidPermission('')).toBe(false);
    expect(isValidPermission('toString')).toBe(false); // not an own prop
    expect(isValidPermission(undefined)).toBe(false);
  });
});

describe('resolveEffectivePermissions', () => {
  it('catalog default denies everything when no rows / no overrides', () => {
    const eff = resolveEffectivePermissions([], {});
    expect(Object.keys(eff).sort()).toEqual([...PERMISSION_KEYS].sort());
    for (const key of PERMISSION_KEYS) expect(eff[key]).toBe(false);
  });

  it('every catalog key is present in the output', () => {
    const eff = resolveEffectivePermissions(
      [{ permission_key: 'finance.view', allowed: true }],
      { 'crm.view': true },
    );
    for (const key of PERMISSION_KEYS) {
      expect(Object.prototype.hasOwnProperty.call(eff, key)).toBe(true);
      expect(typeof eff[key]).toBe('boolean');
    }
  });

  it('applies role rows over the catalog deny', () => {
    const eff = resolveEffectivePermissions(
      [
        { permission_key: 'finance.view', allowed: true },
        { permission_key: 'crm.view', allowed: false },
      ],
      {},
    );
    expect(eff['finance.view']).toBe(true);
    expect(eff['crm.view']).toBe(false);
    expect(eff['valuation.view']).toBe(false); // untouched -> deny
  });

  it('user override beats the role default (both directions)', () => {
    const rows = [
      { permission_key: 'finance.view', allowed: true },
      { permission_key: 'crm.view', allowed: false },
    ];
    const eff = resolveEffectivePermissions(rows, {
      'finance.view': false, // override revokes a granted role default
      'crm.view': true, // override grants a denied role default
    });
    expect(eff['finance.view']).toBe(false);
    expect(eff['crm.view']).toBe(true);
  });

  it('ignores unknown keys in role rows and in overrides', () => {
    const eff = resolveEffectivePermissions(
      [
        { permission_key: 'finance.view', allowed: true },
        { permission_key: 'made.up.key', allowed: true },
      ],
      { 'also.fake': true, 'crm.view': true },
    );
    expect(eff['made.up.key']).toBeUndefined();
    expect(eff['also.fake']).toBeUndefined();
    expect(eff['finance.view']).toBe(true);
    expect(eff['crm.view']).toBe(true);
    expect(Object.keys(eff).sort()).toEqual([...PERMISSION_KEYS].sort());
  });

  it('handles null / undefined / non-object inputs without throwing', () => {
    const a = resolveEffectivePermissions(null, null);
    const b = resolveEffectivePermissions(undefined, undefined);
    const c = resolveEffectivePermissions([], 'not-an-object');
    for (const eff of [a, b, c]) {
      expect(Object.keys(eff).sort()).toEqual([...PERMISSION_KEYS].sort());
      for (const key of PERMISSION_KEYS) expect(eff[key]).toBe(false);
    }
  });

  it('coerces truthy/falsy allowed values to strict booleans', () => {
    const eff = resolveEffectivePermissions(
      [{ permission_key: 'finance.view', allowed: 1 }],
      { 'crm.view': 0 },
    );
    expect(eff['finance.view']).toBe(true);
    expect(eff['crm.view']).toBe(false);
  });

  it('catalog labels are non-empty strings (sanity)', () => {
    for (const key of PERMISSION_KEYS) {
      expect(typeof PERMISSION_CATALOG[key]).toBe('string');
      expect(PERMISSION_CATALOG[key].length).toBeGreaterThan(0);
    }
  });
});
