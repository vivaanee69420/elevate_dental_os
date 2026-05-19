import { describe, it, expect } from 'vitest';
import './setup.js';

const { canManageTarget } = await import('../src/services/auth.service.js');

// ┌ owner ──────► anyone
// └ non-owner ──► strictly lower rank only (owner=3 > pm=2 > reception=1)
describe('canManageTarget', () => {
  it('owner may target every role (incl. owner)', () => {
    expect(canManageTarget('owner', 'owner')).toBe(true);
    expect(canManageTarget('owner', 'practice_manager')).toBe(true);
    expect(canManageTarget('owner', 'reception')).toBe(true);
  });

  it('practice_manager may target only reception', () => {
    expect(canManageTarget('practice_manager', 'reception')).toBe(true);
    expect(canManageTarget('practice_manager', 'practice_manager')).toBe(false);
    expect(canManageTarget('practice_manager', 'owner')).toBe(false);
  });

  it('reception may target nobody', () => {
    expect(canManageTarget('reception', 'reception')).toBe(false);
    expect(canManageTarget('reception', 'practice_manager')).toBe(false);
    expect(canManageTarget('reception', 'owner')).toBe(false);
  });

  it('unknown roles are denied (non-owner)', () => {
    expect(canManageTarget('superuser', 'reception')).toBe(false);
    expect(canManageTarget('practice_manager', 'superuser')).toBe(false);
  });
});
