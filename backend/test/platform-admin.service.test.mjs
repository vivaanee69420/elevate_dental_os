import { describe, it, expect, beforeEach, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import { supaRec } from './setup.js';

process.env.PLATFORM_ADMIN_JWT_SECRET ||= 'a'.repeat(48);

const { platformAdminService } = await import(
  '../src/services/platform-admin.service.js'
);

// The setup.js fake routes every supabase call through a single resultProvider.
// We dispatch by (table, op) so one provider can serve a multi-step request.
function dispatch(routes) {
  return (q) => {
    const key = `${q.table}:${q.op}`;
    const handler = routes[key];
    if (!handler) {
      return { data: null, error: null, count: 0 };
    }
    return handler(q);
  };
}

const PWD = 'correct-horse-battery-staple-123';
let HASH;

beforeEach(async () => {
  HASH ??= await bcrypt.hash(PWD, 4);
});

describe('platformAdminService.login', () => {
  it('returns a JWT and writes one audit row on success', async () => {
    const auditInserts = [];
    supaRec.resultProvider = dispatch({
      'platform_admins:select': () => ({
        data: {
          id: 'a1',
          email: 'admin@x',
          password_hash: HASH,
          full_name: 'A',
          role: 'superadmin',
          must_change_password: false,
        },
        error: null,
      }),
      'platform_admins:update': () => ({ data: null, error: null }),
      'platform_audit_log:insert': (q) => {
        auditInserts.push(q.insertVals);
        return { data: null, error: null };
      },
    });

    const req = { ip: '1.2.3.4', headers: { 'user-agent': 'jest' } };
    // Service reads req.platformIp / req.platformUserAgent (set by middleware).
    req.platformIp = '1.2.3.4';
    req.platformUserAgent = 'jest';

    const out = await platformAdminService.login({ email: 'admin@x', password: PWD }, req);

    expect(out.token).toBeTypeOf('string');
    expect(out.admin).toMatchObject({ id: 'a1', role: 'superadmin' });
    expect(auditInserts).toHaveLength(1);
    expect(auditInserts[0]).toMatchObject({
      platform_admin_id: 'a1',
      action: 'login',
      ip_address: '1.2.3.4',
      user_agent: 'jest',
    });
  });

  it('401s on wrong password (and writes NO audit row)', async () => {
    const auditInserts = [];
    supaRec.resultProvider = dispatch({
      'platform_admins:select': () => ({
        data: { id: 'a1', email: 'admin@x', password_hash: HASH, role: 'superadmin', must_change_password: false },
        error: null,
      }),
      'platform_audit_log:insert': (q) => {
        auditInserts.push(q.insertVals);
        return { data: null, error: null };
      },
    });

    await expect(
      platformAdminService.login({ email: 'admin@x', password: 'wrong' }, { platformIp: '1', platformUserAgent: 'j' }),
    ).rejects.toMatchObject({ statusCode: 401 });
    expect(auditInserts).toHaveLength(0);
  });

  it('401s when the admin does not exist', async () => {
    supaRec.resultProvider = dispatch({
      'platform_admins:select': () => ({ data: null, error: null }),
    });
    await expect(
      platformAdminService.login({ email: 'nope@x', password: PWD }, {}),
    ).rejects.toMatchObject({ statusCode: 401 });
  });
});

describe('platformAdminService.listOrgs', () => {
  it('returns rows and audit-logs the action with count', async () => {
    const auditInserts = [];
    supaRec.resultProvider = dispatch({
      'organisations:select': () => ({
        data: [{ id: 'o1', name: 'GM Dental', slug: 'gm', plan: 'pro', created_at: 't' }],
        error: null,
        count: 1,
      }),
      'platform_audit_log:insert': (q) => {
        auditInserts.push(q.insertVals);
        return { data: null, error: null };
      },
    });

    const out = await platformAdminService.listOrgs(
      { id: 'a1', email: 'admin@x', role: 'superadmin' },
      { q: undefined, limit: 50, offset: 0 },
      { platformIp: '1', platformUserAgent: 'j' },
    );

    expect(out.rows).toHaveLength(1);
    expect(out.total).toBe(1);
    expect(auditInserts).toHaveLength(1);
    expect(auditInserts[0].action).toBe('list_orgs');
    expect(auditInserts[0].payload).toMatchObject({ count: 1 });
  });

  it('fails the request if audit insert fails (fail-closed)', async () => {
    supaRec.resultProvider = dispatch({
      'organisations:select': () => ({ data: [], error: null, count: 0 }),
      'platform_audit_log:insert': () => ({ data: null, error: { message: 'boom' } }),
    });

    await expect(
      platformAdminService.listOrgs(
        { id: 'a1', email: 'admin@x', role: 'superadmin' },
        { q: undefined, limit: 50, offset: 0 },
        {},
      ),
    ).rejects.toBeTruthy();
  });
});
