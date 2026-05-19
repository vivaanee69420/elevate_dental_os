import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

// Real repository + real service running over the fake Supabase client
// installed by test/setup.js (require-cache stub — no network/DB). We drive
// behaviour via supaRec.resultProvider and inspect supaRec.last.
const { permissionsService } = await import(
  '../src/services/permissions.service.js'
);
const permPkg = await import('../src/lib/permissions.js');
const { PERMISSION_KEYS } = permPkg.default;
// NOTE: we assert on .statusCode/.name rather than `instanceof AppError`.
// The service requires its own copy of middleware/errors; under vitest's
// module graph an `await import()` here can yield a distinct class identity,
// so an instanceof check is unreliable (and not the contract that matters).

beforeEach(() => {
  supaRec.last = undefined;
  supaRec.resultProvider = () => ({ data: [], error: null });
});

describe('getEffectiveForUser', () => {
  it('merges role rows then user overrides via the pure resolver', async () => {
    supaRec.resultProvider = () => ({
      data: [
        { permission_key: 'finance.view', allowed: true },
        { permission_key: 'crm.view', allowed: true },
      ],
      error: null,
    });
    const eff = await permissionsService.getEffectiveForUser('org-1', 'owner', {
      'crm.view': false,
    });
    expect(eff['finance.view']).toBe(true);
    expect(eff['crm.view']).toBe(false); // override wins over role default
    expect(Object.keys(eff).sort()).toEqual([...PERMISSION_KEYS].sort());
    // Read was scoped by (org, role).
    expect(supaRec.last.eqs).toContainEqual({
      col: 'organisation_id',
      val: 'org-1',
    });
    expect(supaRec.last.eqs).toContainEqual({ col: 'role', val: 'owner' });
  });
});

describe('getMatrix', () => {
  it('returns catalog + all three roles defaulting false, rows applied', async () => {
    supaRec.resultProvider = () => ({
      data: [
        { role: 'owner', permission_key: 'finance.view', allowed: true },
        { role: 'reception', permission_key: 'crm.view', allowed: true },
        { role: 'owner', permission_key: 'fake.key', allowed: true },
      ],
      error: null,
    });
    const m = await permissionsService.getMatrix('org-1');
    expect(Object.keys(m.roles).sort()).toEqual([
      'owner',
      'practice_manager',
      'reception',
    ]);
    expect(m.roles.owner['finance.view']).toBe(true);
    expect(m.roles.reception['crm.view']).toBe(true);
    expect(m.roles.practice_manager['finance.view']).toBe(false);
    expect(m.roles.owner['fake.key']).toBeUndefined(); // unknown key dropped
    expect(m.catalog).toHaveProperty('finance.view');
    for (const key of PERMISSION_KEYS) {
      expect(typeof m.roles.owner[key]).toBe('boolean');
    }
  });
});

describe('setRoleDefault', () => {
  it('rejects an unknown role with AppError 400', async () => {
    await expect(
      permissionsService.setRoleDefault(
        'org-1',
        'superuser',
        'finance.view',
        true,
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects an unknown permission key with AppError 400', async () => {
    const err = await permissionsService
      .setRoleDefault('org-1', 'owner', 'fake.key', true)
      .catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.constructor.name).toBe('AppError');
    expect(err.statusCode).toBe(400);
    expect(err.message).toMatch(/Unknown permission/);
  });

  it('upserts a valid (role, key), coercing allowed to boolean', async () => {
    const r = await permissionsService.setRoleDefault(
      'org-1',
      'reception',
      'crm.view',
      1,
    );
    expect(r).toEqual({ success: true });
    expect(supaRec.last.op).toBe('upsert');
    expect(supaRec.last.upsertVals).toMatchObject({
      organisation_id: 'org-1',
      role: 'reception',
      permission_key: 'crm.view',
      allowed: true,
    });
  });
});

describe('setUserOverride', () => {
  it('rejects an unknown permission key with AppError 400', async () => {
    await expect(
      permissionsService.setUserOverride('org-1', 'u1', 'fake.key', true),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('clean 404 when getUser returns null (org filter silently excludes the row)', async () => {
    // The intended not-found path: repo.getUser resolves null (no error) ->
    // service raises AppError 404. This is what the service contract maps.
    supaRec.resultProvider = (q) =>
      q.op === 'select'
        ? { data: null, error: null }
        : { data: null, error: null };
    await expect(
      permissionsService.setUserOverride('org-1', 'u1', 'finance.view', true),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(supaRec.last.op).toBe('select'); // never reached the update
  });

  it('GAP: a raw PostgREST "no rows" error from .single() is NOT mapped to 404', async () => {
    // FINDING (documented): repositories/permissions.repository.getUser does
    // `.single()` then `if (error) throw error`. A genuinely missing row on
    // a real DB makes PostgREST return error code PGRST116, so the repo
    // throws the raw error and the service's `if (!user) -> 404` branch is
    // never reached. The clean 404 only happens when getUser resolves null
    // (the RLS/org-filter "row invisible" case). This test pins current
    // behaviour so a future fix (treating PGRST116 as not-found) is a
    // deliberate, visible change. NOT a test bug — a src observation.
    supaRec.resultProvider = () => ({
      data: null,
      error: { code: 'PGRST116', message: 'no rows' },
    });
    const err = await permissionsService
      .setUserOverride('org-1', 'u1', 'finance.view', true)
      .catch((e) => e);
    expect(err).toBeTruthy();
    expect(err.statusCode).toBeUndefined(); // raw PG error, not an AppError 404
    expect(err.code).toBe('PGRST116');
  });

  it('sets a value override, preserving other keys', async () => {
    supaRec.resultProvider = (q) =>
      q.op === 'select'
        ? {
            data: { id: 'u1', permissions: { 'crm.view': true } },
            error: null,
          }
        : { data: null, error: null };
    const r = await permissionsService.setUserOverride(
      'org-1',
      'u1',
      'finance.view',
      true,
    );
    expect(r.permissions).toEqual({ 'crm.view': true, 'finance.view': true });
    expect(supaRec.last.op).toBe('update');
    expect(supaRec.last.updateVals).toEqual({
      permissions: { 'crm.view': true, 'finance.view': true },
    });
  });

  it('clears the key when allowed === null', async () => {
    supaRec.resultProvider = (q) =>
      q.op === 'select'
        ? {
            data: {
              id: 'u1',
              permissions: { 'crm.view': true, 'finance.view': false },
            },
            error: null,
          }
        : { data: null, error: null };
    const r = await permissionsService.setUserOverride(
      'org-1',
      'u1',
      'finance.view',
      null,
    );
    expect(r.permissions).toEqual({ 'crm.view': true });
    expect(r.permissions).not.toHaveProperty('finance.view');
  });
});
