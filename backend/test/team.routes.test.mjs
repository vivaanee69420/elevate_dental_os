// The gates on /api/admin/team, asserted by RUNNING them. requireRole and
// requirePermission both return anonymous closures, so identifying them by
// name is not possible — a non-owner must actually be refused.
import { describe, it, expect, vi } from 'vitest';
import './setup.js';

vi.mock('../src/services/team.service.js', () => ({
  adminScope: vi.fn(async () => ({ orgIds: ['org-1'], agencyWide: false, agencyOrgId: null })),
  teamService: {
    list: vi.fn(async () => ({ members: [], agency_wide: false })),
    get: vi.fn(async () => ({})),
    save: vi.fn(async () => ({ success: true })),
    create: vi.fn(async () => ({ success: true, user_id: 'x' })),
    remove: vi.fn(async () => ({ success: true })),
    setPassword: vi.fn(async () => ({ success: true })),
  },
}));

const router = (await import('../src/routes/members.routes.js')).default;
const { teamService } = await import('../src/services/team.service.js');

/** Run every middleware on a matched route until one responds. */
async function runRoute(method, path, req) {
  const layer = router.stack.find(
    (l) => l.route && l.route.path === path && l.route.methods[method],
  );
  expect(layer, `${method.toUpperCase()} ${path} is not registered`).toBeTruthy();
  let status = 200;
  let body;
  const res = {
    status(c) { status = c; return res; },
    json(b) { body = b; return res; },
  };
  for (const s of layer.route.stack) {
    let advanced = false;
    await s.handle(req, res, () => { advanced = true; });
    if (!advanced) break;
  }
  return { status, body };
}

const TARGET = '99999999-9999-4999-8999-999999999999';
const OWNER = { id: 'u1', organisation_id: 'org-1', role: 'owner', permissions: { 'users.manage': true, 'users.invite': true } };
const PM = { id: 'u2', organisation_id: 'org-1', role: 'practice_manager', permissions: { 'users.manage': true, 'users.invite': true } };

describe('/api/admin/team gates', () => {
  it('registers the static POSTs before /:id so they are not shadowed', () => {
    const paths = router.stack.filter((l) => l.route).map((l) => l.route.path);
    for (const p of ['/invite', '/provision', '/password', '/remove']) {
      expect(paths.indexOf(p)).toBeLessThan(paths.indexOf('/:id'));
    }
  });

  it('GET /:id refuses a practice manager who holds users.manage', async () => {
    const out = await runRoute('get', '/:id', { user: PM, params: { id: 'u9' } });
    expect(out.status).toBe(403);
  });

  it('PUT /:id refuses a practice manager who holds users.manage', async () => {
    const out = await runRoute('put', '/:id', { user: PM, params: { id: 'u9' }, body: {} });
    expect(out.status).toBe(403);
  });

  it('POST / refuses a practice manager who holds users.manage', async () => {
    const out = await runRoute('post', '/', { user: PM, body: {} });
    expect(out.status).toBe(403);
  });

  it('GET /:id admits an owner', async () => {
    const out = await runRoute('get', '/:id', { user: OWNER, params: { id: 'u9' } });
    expect(out.status).toBe(200);
  });

  it('GET / stays on users.invite, so a practice manager can still read the team', async () => {
    const out = await runRoute('get', '/', { user: PM });
    expect(out.status).toBe(200);
  });
});

// Remove and Set password go through adminScope + teamService like their
// siblings, so a sub-account row can actually be acted on; and a write that
// lands in another org stamps the audit fields middleware/audit.js reads.
describe('/api/admin/team cross-org writes', () => {
  it('POST /remove resolves the target through adminScope, not the caller org', async () => {
    const req = { user: OWNER, body: { user_id: TARGET } };
    const out = await runRoute('post', '/remove', req);
    expect(out.status).toBe(200);
    expect(teamService.remove).toHaveBeenCalledWith(
      { orgIds: ['org-1'], agencyWide: false, agencyOrgId: null },
      OWNER,
      TARGET,
    );
  });

  it('POST /password resolves the target through adminScope, not the caller org', async () => {
    const req = { user: OWNER, body: { user_id: TARGET, password: 'hunter2hunter2' } };
    const out = await runRoute('post', '/password', req);
    expect(out.status).toBe(200);
    expect(teamService.setPassword).toHaveBeenCalledWith(
      { orgIds: ['org-1'], agencyWide: false, agencyOrgId: null },
      OWNER,
      TARGET,
      'hunter2hunter2',
    );
  });

  it('stamps the affected org and a via_agency marker when the write lands elsewhere', async () => {
    teamService.remove.mockResolvedValueOnce({ success: true, organisation_id: 'sub-9' });
    const req = { user: OWNER, agencyOrgId: 'org-1', body: { user_id: TARGET } };
    await runRoute('post', '/remove', req);
    expect(req.auditOrgId).toBe('sub-9');
    expect(req.auditVia).toEqual({ home_organisation_id: 'org-1', actor_user_id: 'u1' });
  });

  it('stamps nothing for a same-org write, so the audit row is unchanged', async () => {
    teamService.remove.mockResolvedValueOnce({ success: true, organisation_id: 'org-1' });
    const req = { user: OWNER, body: { user_id: TARGET } };
    await runRoute('post', '/remove', req);
    expect(req.auditOrgId).toBeUndefined();
    expect(req.auditVia).toBeUndefined();
  });

  it('PUT /:id stamps the org the save landed in', async () => {
    teamService.save.mockResolvedValueOnce({ success: true, organisation_id: 'sub-9' });
    const req = { user: OWNER, agencyOrgId: 'org-1', params: { id: 'u-9' }, body: {} };
    await runRoute('put', '/:id', req);
    expect(req.auditOrgId).toBe('sub-9');
  });

  it('POST / stamps the org the new login was created in', async () => {
    teamService.create.mockResolvedValueOnce({ success: true, user_id: 'x', organisation_id: 'sub-9' });
    const req = {
      user: OWNER,
      agencyOrgId: 'org-1',
      body: { email: 'a@x.dev', full_name: 'A', role: 'reception' },
    };
    await runRoute('post', '/', req);
    expect(req.auditOrgId).toBe('sub-9');
  });
});
