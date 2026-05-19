import { describe, it, expect, beforeEach, vi } from 'vitest';
import { supaRec } from './setup.js';

const { authService } = await import('../src/services/auth.service.js');

const OWNER = { id: 'me', role: 'owner', permissions: {} };
const PM = { id: 'pm', role: 'practice_manager', permissions: { 'crm.view': true } };

// Admin-call outcomes by GoTrue method. listUsers must return the paginated
// shape so the orphan scan terminates cleanly with "no orphan".
function adminOK(m) {
  if (m === 'listUsers') return { data: { users: [] }, error: null };
  if (m === 'createUser') return { data: { user: { id: 'u1' } }, error: null };
  return { data: {}, error: null };
}

beforeEach(() => {
  supaRec.last = undefined;
  supaRec.adminCalls = [];
  supaRec.adminProvider = (m) => adminOK(m);
  supaRec.resultProvider = () => ({ data: [], error: null });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200 })),
  );
});

const calledAdmin = (m) =>
  (supaRec.adminCalls || []).some((c) => c.m === m);

describe('provisionMember', () => {
  it('happy: creates active member, returns user_id', async () => {
    supaRec.resultProvider = (q) =>
      q.op === 'insert' ? { data: null, error: null } : { data: null, error: null };
    const r = await authService.provisionMember('org1', OWNER, {
      email: 'a@b.co',
      full_name: 'A',
      role: 'reception',
      password: 'pw12345678',
    });
    expect(r).toEqual({ success: true, user_id: 'u1', status: 'active' });
    expect(calledAdmin('createUser')).toBe(true);
  });

  it('403 when caller may not manage that role (guard, no IO)', async () => {
    await expect(
      authService.provisionMember('org1', PM, {
        email: 'a@b.co',
        full_name: 'A',
        role: 'owner',
        password: 'pw12345678',
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(supaRec.adminCalls.length).toBe(0);
  });

  it('403 when granting a permission the caller does not hold (grant ceiling)', async () => {
    await expect(
      authService.provisionMember('org1', PM, {
        email: 'a@b.co',
        full_name: 'A',
        role: 'reception',
        password: 'pw12345678',
        permissions: { 'finance.view': true },
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(supaRec.adminCalls.length).toBe(0);
  });

  it('rolls back the auth identity when the users insert fails', async () => {
    supaRec.resultProvider = (q) =>
      q.op === 'insert'
        ? { data: null, error: { message: 'duplicate' } }
        : { data: null, error: null };
    await expect(
      authService.provisionMember('org1', OWNER, {
        email: 'a@b.co',
        full_name: 'A',
        role: 'reception',
        password: 'pw12345678',
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    // compensating deleteAuthUser fired with the just-created id
    const del = supaRec.adminCalls.find((c) => c.m === 'deleteUser');
    expect(del).toBeTruthy();
    expect(del.args[0]).toBe('u1');
  });

  it('409 when the email is a live account (orphan reclaim guard)', async () => {
    supaRec.adminProvider = (m) =>
      m === 'listUsers'
        ? { data: { users: [{ id: 'old', email: 'a@b.co' }] }, error: null }
        : adminOK(m);
    // getUserById for 'old' returns a live row -> reject 409
    supaRec.resultProvider = () => ({ data: { id: 'old' }, error: null });
    await expect(
      authService.provisionMember('org1', OWNER, {
        email: 'a@b.co',
        full_name: 'A',
        role: 'reception',
        password: 'pw12345678',
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('setMemberPassword', () => {
  it('400 when targeting self (use account settings)', async () => {
    await expect(
      authService.setMemberPassword('org1', OWNER, 'me', 'pw12345678'),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('404 when target not in caller org', async () => {
    supaRec.resultProvider = () => ({ data: null, error: null });
    await expect(
      authService.setMemberPassword('org1', OWNER, 'ghost', 'pw12345678'),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('403 when target outranks caller', async () => {
    supaRec.resultProvider = () => ({
      data: { id: 't', role: 'owner' },
      error: null,
    });
    await expect(
      authService.setMemberPassword('org1', PM, 't', 'pw12345678'),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(calledAdmin('updateUserById')).toBe(false);
  });

  it('happy: updates password and revokes sessions', async () => {
    supaRec.resultProvider = () => ({
      data: { id: 't', role: 'reception' },
      error: null,
    });
    const r = await authService.setMemberPassword('org1', OWNER, 't', 'pw12345678');
    expect(r).toEqual({ success: true });
    expect(calledAdmin('updateUserById')).toBe(true);
    expect(global.fetch).toHaveBeenCalledOnce(); // revokeUserSessions
  });
});

describe('removeMember (regression: role-hierarchy guard)', () => {
  it('400 when removing self', async () => {
    await expect(
      authService.removeMember('org1', OWNER, 'me'),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('REGRESSION: non-owner can no longer remove the owner (was: allowed)', async () => {
    supaRec.resultProvider = () => ({
      data: { id: 'o', role: 'owner' },
      error: null,
    });
    await expect(
      authService.removeMember('org1', PM, 'o'),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('owner may still remove a lower role', async () => {
    supaRec.resultProvider = (q) =>
      q.op === 'select'
        ? { data: { id: 'r', role: 'reception' }, error: null }
        : { data: null, error: null };
    const r = await authService.removeMember('org1', OWNER, 'r');
    expect(r).toEqual({ success: true });
    expect(calledAdmin('deleteUser')).toBe(true);
  });
});
