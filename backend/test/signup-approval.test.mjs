import { describe, it, expect, beforeEach, vi } from 'vitest';
import { supaRec } from './setup.js';

process.env.PLATFORM_ADMIN_JWT_SECRET ||= 'a'.repeat(48);

const { authService } = await import('../src/services/auth.service.js');
const { platformAdminService } = await import('../src/services/platform-admin.service.js');

// One provider serving a multi-step request, dispatched by `${table}:${op}`.
function dispatch(routes) {
  return (q) => {
    const handler = routes[`${q.table}:${q.op}`];
    return handler ? handler(q) : { data: null, error: null, count: 0 };
  };
}

// GoTrue admin outcomes: clean orphan scan + a fresh auth user.
function adminOK(m) {
  if (m === 'listUsers') return { data: { users: [] }, error: null };
  if (m === 'createUser') return { data: { user: { id: 'u1' } }, error: null };
  return { data: {}, error: null };
}

beforeEach(() => {
  supaRec.adminCalls = [];
  supaRec.rpcCalls = [];
  supaRec.rpcProvider = undefined; // seed_role_permissions falls through (ignored)
  supaRec.adminProvider = (m) => adminOK(m);
  supaRec.resultProvider = () => ({ data: [], error: null });
});

// ---- provisionOrgOwner via public signup ---------------------------------
describe('authService.signup (self-serve → pending approval)', () => {
  it('inserts the owner with status "pending" and reports awaiting approval', async () => {
    let ownerInsert;
    supaRec.resultProvider = dispatch({
      'organisations:select': () => ({ data: { id: 'o1' }, error: null }),
      'users:insert': (q) => { ownerInsert = q.insertVals; return { data: null, error: null }; },
      'membership_plans:insert': () => ({ data: null, error: null }),
    });

    const out = await authService.signup({
      email: 'new@practice.co',
      password: 'pw12345678',
      full_name: 'Dr New',
      organisation_name: 'New Practice',
    });

    expect(out).toMatchObject({ success: true, status: 'pending' });
    expect(out.organisation_id).toBe('o1');
    expect(ownerInsert).toMatchObject({ role: 'owner', status: 'pending' });
  });
});

// ---- login approval gate --------------------------------------------------
describe('authService.login (approval gate)', () => {
  function withSession(row) {
    supaRec.adminProvider = (m) =>
      m === 'signInWithPassword'
        ? { data: { session: { access_token: 'at', refresh_token: 'rt', expires_at: 1 }, user: { id: 'u1' } }, error: null }
        : adminOK(m);
    supaRec.resultProvider = dispatch({
      'users:select': () => ({ data: row, error: null }),
      'users:update': () => ({ data: null, error: null }),
    });
  }

  it('403s a pending owner (cannot log in until approved)', async () => {
    withSession({ id: 'u1', organisation_id: 'o1', role: 'owner', status: 'pending' });
    await expect(
      authService.login({ email: 'a@b.co', password: 'pw12345678' }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('403s a rejected owner', async () => {
    withSession({ id: 'u1', organisation_id: 'o1', role: 'owner', status: 'rejected' });
    await expect(
      authService.login({ email: 'a@b.co', password: 'pw12345678' }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('returns tokens for an active owner', async () => {
    withSession({ id: 'u1', organisation_id: 'o1', role: 'owner', status: 'active' });
    const out = await authService.login({ email: 'a@b.co', password: 'pw12345678' });
    expect(out).toMatchObject({ access_token: 'at', refresh_token: 'rt' });
  });
});

// ---- platform-admin create-org (auto-approved owner) ----------------------
describe('platformAdminService.createOrg', () => {
  const ADMIN = { id: 'a1', email: 'admin@x', role: 'superadmin' };
  const REQ = { platformIp: '1.2.3.4', platformUserAgent: 'jest' };

  it('creates an active owner, returns a temp password, audits without leaking it', async () => {
    let ownerInsert;
    let auditRow;
    supaRec.resultProvider = dispatch({
      'organisations:select': () => ({ data: { id: 'o9' }, error: null }),
      'users:insert': (q) => { ownerInsert = q.insertVals; return { data: null, error: null }; },
      'membership_plans:insert': () => ({ data: null, error: null }),
      'platform_audit_log:insert': (q) => { auditRow = q.insertVals; return { data: null, error: null }; },
    });

    const out = await platformAdminService.createOrg(
      ADMIN,
      { email: 'owner@new.co', full_name: 'Owner', organisation_name: 'New Co' },
      REQ,
    );

    expect(out.organisation_id).toBe('o9');
    expect(out.temp_password).toBeTypeOf('string');
    expect(out.temp_password.length).toBeGreaterThanOrEqual(12);
    expect(ownerInsert).toMatchObject({ role: 'owner', status: 'active' });
    expect(auditRow.action).toBe('create_org');
    // Temp password must NOT appear anywhere in the audit payload.
    expect(JSON.stringify(auditRow.payload)).not.toContain(out.temp_password);
  });
});

// ---- platform-admin approve / reject --------------------------------------
describe('platformAdminService.approveSignup / rejectSignup', () => {
  const ADMIN = { id: 'a1', email: 'admin@x', role: 'superadmin' };
  const REQ = { platformIp: '1', platformUserAgent: 'j' };

  function withOwner(row, captureUpdate) {
    supaRec.resultProvider = dispatch({
      'users:select': () => ({ data: row, error: null }),
      'users:update': (q) => { captureUpdate?.(q.updateVals); return { data: null, error: null }; },
      'platform_audit_log:insert': () => ({ data: null, error: null }),
    });
  }

  it('approve: pending owner → active', async () => {
    let upd;
    withOwner({ id: 'u1', role: 'owner', status: 'pending', organisation_id: 'o1' }, (v) => { upd = v; });
    const out = await platformAdminService.approveSignup(ADMIN, 'u1', REQ);
    expect(out).toEqual({ ok: true, status: 'active' });
    expect(upd).toMatchObject({ status: 'active' });
  });

  it('approve: 404 when the target is not an owner', async () => {
    withOwner({ id: 'u1', role: 'reception', status: 'pending', organisation_id: 'o1' });
    await expect(platformAdminService.approveSignup(ADMIN, 'u1', REQ)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('approve: 409 when the account is not pending', async () => {
    withOwner({ id: 'u1', role: 'owner', status: 'active', organisation_id: 'o1' });
    await expect(platformAdminService.approveSignup(ADMIN, 'u1', REQ)).rejects.toMatchObject({ statusCode: 409 });
  });

  it('reject: pending owner → rejected', async () => {
    let upd;
    withOwner({ id: 'u1', role: 'owner', status: 'pending', organisation_id: 'o1' }, (v) => { upd = v; });
    const out = await platformAdminService.rejectSignup(ADMIN, 'u1', REQ);
    expect(out).toEqual({ ok: true, status: 'rejected' });
    expect(upd).toMatchObject({ status: 'rejected' });
  });
});
