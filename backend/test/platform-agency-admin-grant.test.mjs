// Superadmin grants/revokes agency access per user (users.is_agency_admin).
// Agency powers — sub-account creation, practice mapping, production logs —
// are no longer implied by owning an org, so there has to be an explicit way
// to hand them out. That lever belongs to the platform superadmin.
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../src/repositories/platform-admin.repository.js', () => ({
  platformAdminRepository: {
    setAgencyAdmin: vi.fn(async () => ({ id: 'u1', email: 'x@y.dev', is_agency_admin: true })),
    insertAudit: vi.fn(async () => {}),
  },
}));

const { platformAdminRepository } = await import('../src/repositories/platform-admin.repository.js');
const { platformAdminService } = await import('../src/services/platform-admin.service.js');
const router = (await import('../src/routes/platform-admin.routes.js')).default;

const ADMIN = { id: 'admin-1', email: 'super@x.dev', role: 'superadmin' };

beforeEach(() => vi.clearAllMocks());

describe('setAgencyAdmin', () => {
  it('flips the flag and audits the grant with the target user', async () => {
    const out = await platformAdminService.setAgencyAdmin(ADMIN, 'u1', true, {});
    expect(platformAdminRepository.setAgencyAdmin).toHaveBeenCalledWith('u1', true);
    expect(out.is_agency_admin).toBe(true);
    const audited = platformAdminRepository.insertAudit.mock.calls[0][0];
    expect(audited.action).toBe('set_agency_admin');
    expect(audited.target_user_id).toBe('u1');
    expect(audited.payload).toMatchObject({ is_agency_admin: true });
  });

  it('revokes as readily as it grants', async () => {
    await platformAdminService.setAgencyAdmin(ADMIN, 'u1', false, {});
    expect(platformAdminRepository.setAgencyAdmin).toHaveBeenCalledWith('u1', false);
  });
});

describe('route wiring', () => {
  it('the grant route is superadmin-gated, not merely platform-authenticated', () => {
    const layer = router.stack.find(
      (l) => l.route?.path === '/users/:id/agency-admin' && l.route.methods.patch,
    );
    expect(layer, 'PATCH /users/:id/agency-admin should exist').toBeTruthy();
    const names = layer.route.stack.map((s) => s.handle?.name);
    expect(names).toContain('platformRoleGate');
  });
});
