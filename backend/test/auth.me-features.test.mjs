import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/services/features.service.js', () => ({
  featuresService: { enabledKeys: vi.fn().mockResolvedValue(['finance', 'crm', 'data_room']) },
}));
vi.mock('../src/services/auth.service.js', () => ({
  authService: { organisationName: vi.fn().mockResolvedValue('Test Org') },
}));
vi.mock('../src/services/org-meta.service.js', () => ({
  orgMetaService: {
    getOrgMeta: vi.fn(async () => ({ id: 'org-1', name: 'Test Org', is_agency: true, parent_organisation_id: null })),
  },
}));

const { authController } = await import('../src/controllers/auth.controller.js');
const { featuresService } = await import('../src/services/features.service.js');

describe('GET /auth/me', () => {
  it('includes the enabled feature keys for the caller org', async () => {
    const req = {
      user: {
        id: 'u1', email: 'o@t.dev', role: 'owner',
        organisation_id: 'org-1', permissions: { 'crm.view': true },
      },
    };
    const res = { json: vi.fn() };
    await authController.me(req, res);
    expect(featuresService.enabledKeys).toHaveBeenCalledWith('org-1');
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ features: ['finance', 'crm', 'data_room'] }),
    );
  });

  it('includes the agency shape (unswitched agency owner)', async () => {
    const req = {
      user: { id: 'u1', email: 'o@t.dev', role: 'owner', organisation_id: 'org-1', permissions: {}, is_agency_admin: true },
    };
    const res = { json: vi.fn() };
    await authController.me(req, res);
    expect(res.json.mock.calls[0][0].agency).toEqual({
      is_agency_actor: true, switched: false, home_org: null,
    });
  });

  it('includes home_org while switched', async () => {
    const req = {
      user: { id: 'u1', email: 'o@t.dev', role: 'owner', organisation_id: 'sub-1', permissions: {}, is_agency_admin: true },
      agencyContext: { actorUserId: 'u1', homeOrgId: 'org-1' },
    };
    const res = { json: vi.fn() };
    await authController.me(req, res);
    expect(res.json.mock.calls[0][0].agency).toEqual({
      is_agency_actor: true, switched: true, home_org: { id: 'org-1', name: 'Test Org' },
    });
  });
});
