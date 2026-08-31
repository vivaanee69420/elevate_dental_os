// Cross-org regression (isolation audit A4): /api/admin/logs serves the
// PROCESS-WIDE pino files under LOG_DIR. Those lines carry every tenant's
// organisation ids, user emails and integration/webhook diagnostics, and the
// controller has no org concept at all (it cannot filter what it reads).
// requireRole('owner') was therefore not a boundary once a second tenant
// existed — a sub-account owner could tail another practice group's logs.
// Restricted to agency actors: only we read production logs.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/services/org-meta.service.js', () => ({
  orgMetaService: { getOrgMeta: vi.fn(async (id) => ({ id, is_agency: id === 'agency-1', parent_organisation_id: null })) },
}));

const { requireAgencyActor } = await import('../src/middleware/agency.js');
const { buildApp } = await import('../src/app.js');

// The '/admin/logs' guards sit as their own layers on the /api router, each
// matching the same mount path. Collect the handler names on those layers.
function logsMountHandlers() {
  const app = buildApp();
  const names = [];
  for (const layer of app._router.stack) {
    const inner = layer.handle?.stack;
    if (!Array.isArray(inner)) continue;
    for (const l of inner) {
      const path = l.regexp?.toString() ?? '';
      if (path.includes('admin') && path.includes('logs')) names.push(l.handle?.name);
    }
  }
  return names;
}

describe('/api/admin/logs mount', () => {
  it('is gated on an agency actor, not merely an org owner', () => {
    const names = logsMountHandlers();
    expect(names.length).toBeGreaterThan(0);
    expect(names).toContain('requireAgencyActor');
  });

  it('requireAgencyActor refuses a plain sub-account owner', async () => {
    const res = { status: vi.fn(() => res), json: vi.fn(() => res) };
    const next = vi.fn();
    await requireAgencyActor({ user: { role: 'owner', organisation_id: 'sub-1' } }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('requireAgencyActor admits a user holding the agency grant', async () => {
    const res = { status: vi.fn(() => res), json: vi.fn(() => res) };
    const next = vi.fn();
    await requireAgencyActor(
      { user: { role: 'owner', organisation_id: 'agency-1', is_agency_admin: true } }, res, next,
    );
    expect(next).toHaveBeenCalledOnce();
  });
});
