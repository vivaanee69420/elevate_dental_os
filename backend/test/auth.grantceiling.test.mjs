import { describe, it, expect } from 'vitest';
import './setup.js';

const { assertGrantCeiling } = await import('../src/services/auth.service.js');

describe('assertGrantCeiling', () => {
  it('owner may grant anything (exempt)', () => {
    const owner = { role: 'owner', permissions: {} };
    expect(() =>
      assertGrantCeiling(owner, { 'system.manage': true, 'finance.view': true }),
    ).not.toThrow();
  });

  it('no permissions map = noop', () => {
    expect(() =>
      assertGrantCeiling({ role: 'practice_manager', permissions: {} }, undefined),
    ).not.toThrow();
  });

  it('non-owner may grant a key it effectively holds', () => {
    const pm = { role: 'practice_manager', permissions: { 'crm.view': true } };
    expect(() => assertGrantCeiling(pm, { 'crm.view': true })).not.toThrow();
  });

  it('non-owner granting an unheld key -> 403', () => {
    const pm = { role: 'practice_manager', permissions: { 'crm.view': true } };
    const err = (() => {
      try {
        assertGrantCeiling(pm, { 'finance.view': true });
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeTruthy();
    expect(err.statusCode).toBe(403);
    expect(err.message).toMatch(/finance\.view/);
  });

  it('narrowing (key:false) is always allowed even if unheld', () => {
    const pm = { role: 'practice_manager', permissions: {} };
    expect(() => assertGrantCeiling(pm, { 'finance.view': false })).not.toThrow();
  });
});
