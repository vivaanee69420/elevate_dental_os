// Structural: every /api/agency route sits behind requireAgencyOwner, and the
// controller passes the HOME org (agencyHomeOrgId) — so the menu still works
// while switched into a child.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/services/agency.service.js', () => ({
  agencyService: {
    listSubaccounts: vi.fn(async () => ({ subaccounts: [] })),
    createSubaccount: vi.fn(async () => ({ organisation_id: 's', owner_id: 'o', owner_email: 'e@x.dev', temp_password: 'p' })),
    subaccountFeatures: vi.fn(async () => ({ features: {}, overrides: [] })),
    setSubaccountFeature: vi.fn(async () => ({ features: {} })),
    switch: vi.fn(async () => ({ token: 't', expires_at: 'x', organisation: { id: 's', name: 'S' } })),
  },
}));
const { agencyService } = await import('../src/services/agency.service.js');
const { agencyController } = await import('../src/controllers/agency.controller.js');
const router = (await import('../src/routes/agency.routes.js')).default;
const { requireAgencyOwner } = await import('../src/middleware/agency.js');

describe('agency routes', () => {
  it('every route is behind requireAgencyOwner', () => {
    const routes = router.stack.filter((l) => l.route);
    expect(routes.length).toBeGreaterThanOrEqual(5);
    for (const layer of routes) {
      const handlers = layer.route.stack.map((s) => s.handle);
      expect(handlers).toContain(requireAgencyOwner);
    }
  });

  it('listSubaccounts acts on the HOME org while switched', async () => {
    const req = {
      user: { id: 'u1', organisation_id: 'sub-1' },
      agencyContext: { actorUserId: 'u1', homeOrgId: 'agency-1' },
    };
    const res = { json: vi.fn() };
    await agencyController.list(req, res);
    expect(agencyService.listSubaccounts).toHaveBeenCalledWith('agency-1');
  });

  it('switch mints for the real user against the home org', async () => {
    const req = {
      user: { id: 'u1', organisation_id: 'agency-1' },
      body: { orgId: '22222222-2222-2222-2222-222222222222' },
    };
    const res = { json: vi.fn() };
    await agencyController.switch(req, res);
    expect(agencyService.switch).toHaveBeenCalledWith('agency-1', 'u1', '22222222-2222-2222-2222-222222222222');
  });

  it('setFeature validates the feature key against the catalog', async () => {
    const req = {
      user: { id: 'u1', organisation_id: 'agency-1' },
      params: { id: '22222222-2222-2222-2222-222222222222' },
      body: { feature: 'not-a-real-key', enabled: true },
    };
    const res = { json: vi.fn() };
    await expect(agencyController.setFeature(req, res)).rejects.toThrow();
    expect(agencyService.setSubaccountFeature).not.toHaveBeenCalled();
  });
});
