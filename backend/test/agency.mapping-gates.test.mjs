// Structural: mapping MUTATIONS carry requireAgencyActor; the corresponding
// reads don't (marketing dashboards consume them). Field-level: GHL account
// PATCH rejects practice_id changes from non-agency actors.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/services/org-meta.service.js', () => ({
  orgMetaService: { getOrgMeta: vi.fn(async () => ({ is_agency: false })) },
}));

const { requireAgencyActor } = await import('../src/middleware/agency.js');
const adAttribution = (await import('../src/routes/ad-attribution.routes.js')).default;
const practices = (await import('../src/routes/practices.routes.js')).default;
const integrations = (await import('../src/routes/integrations.routes.js')).default;

function routesOf(router) {
  return router.stack
    .filter((l) => l.route)
    .map((l) => ({
      path: l.route.path,
      methods: Object.keys(l.route.methods),
      handlers: l.route.stack.map((s) => s.handle),
    }));
}

const gated = (routes, method, path) =>
  routes.some((r) => r.path === path && r.methods.includes(method) && r.handlers.includes(requireAgencyActor));

describe('mapping mutation gates', () => {
  it('ad-attribution mutations require an agency actor; reads do not', () => {
    const r = routesOf(adAttribution);
    expect(gated(r, 'put', '/pipelines/:accountId/:pipelineId')).toBe(true);
    expect(gated(r, 'patch', '/subaccounts/:id')).toBe(true);
    expect(gated(r, 'patch', '/ad-accounts/:id')).toBe(true);
    expect(gated(r, 'get', '/performance')).toBe(false);
    expect(gated(r, 'get', '/config')).toBe(false);
  });

  it('practices pms-site-id mapping requires an agency actor', () => {
    expect(gated(routesOf(practices), 'patch', '/:id/pms-site-id')).toBe(true);
  });

  it('emergent practice mapping requires an agency actor (read stays open)', () => {
    const r = routesOf(integrations);
    expect(gated(r, 'post', '/emergent/practices')).toBe(true);
    expect(gated(r, 'get', '/emergent/practices')).toBe(false);
  });
});

describe('ghlAccountUpdate practice_id field guard', () => {
  it('403s AGENCY_ONLY when a non-actor sends practice_id', async () => {
    const { integrationController } = await import('../src/controllers/integration.controller.js');
    const res = { status: vi.fn(() => res), json: vi.fn(() => res) };
    await integrationController.ghlAccountUpdate(
      {
        params: { id: '33333333-3333-3333-3333-333333333333' },
        body: { practice_id: '44444444-4444-4444-4444-444444444444' },
        user: { role: 'owner', organisation_id: 'sub-1' },
      },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Agency access required', code: 'AGENCY_ONLY' });
  });
});
