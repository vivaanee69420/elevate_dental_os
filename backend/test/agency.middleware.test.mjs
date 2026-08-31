// Agency-actor gates: switched context short-circuits; otherwise owner of an
// is_agency org (cached lookup). Non-actors get 403 AGENCY_ONLY.
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../src/services/org-meta.service.js', () => ({
  orgMetaService: { getOrgMeta: vi.fn() },
}));
const { orgMetaService } = await import('../src/services/org-meta.service.js');
const { isAgencyActor, requireAgencyActor, requireAgencyOwner, agencyHomeOrgId } =
  await import('../src/middleware/agency.js');

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

describe('agency middleware', () => {
  // Braced body on purpose: an implicit-return arrow would hand the mock fn
  // back to vitest, which treats a function returned from a hook as a
  // teardown callback and CALLS it after the test.
  beforeEach(() => { orgMetaService.getOrgMeta.mockReset(); });

  it('switched context is an agency actor without any lookup', async () => {
    const req = {
      user: { role: 'owner', organisation_id: 'sub-1' },
      agencyContext: { actorUserId: 'u1', homeOrgId: 'agency-1' },
    };
    expect(await isAgencyActor(req)).toBe(true);
    expect(orgMetaService.getOrgMeta).not.toHaveBeenCalled();
    expect(agencyHomeOrgId(req)).toBe('agency-1');
  });

  it('unswitched owner of an agency org is an actor (cached lookup)', async () => {
    orgMetaService.getOrgMeta.mockResolvedValue({ id: 'org-1', is_agency: true, parent_organisation_id: null, name: 'A' });
    const req = { user: { role: 'owner', organisation_id: 'org-1' } };
    expect(await isAgencyActor(req)).toBe(true);
    expect(agencyHomeOrgId(req)).toBe('org-1');
  });

  it('owner of a non-agency org is NOT an actor', async () => {
    orgMetaService.getOrgMeta.mockResolvedValue({ id: 'sub-1', is_agency: false, parent_organisation_id: 'org-1', name: 'S' });
    expect(await isAgencyActor({ user: { role: 'owner', organisation_id: 'sub-1' } })).toBe(false);
  });

  it('non-owner of an agency org is NOT an actor', async () => {
    orgMetaService.getOrgMeta.mockResolvedValue({ id: 'org-1', is_agency: true, parent_organisation_id: null, name: 'A' });
    expect(await isAgencyActor({ user: { role: 'practice_manager', organisation_id: 'org-1' } })).toBe(false);
  });

  it('requireAgencyActor 403s AGENCY_ONLY for non-actors and passes actors', async () => {
    orgMetaService.getOrgMeta.mockResolvedValue({ id: 'sub-1', is_agency: false, parent_organisation_id: 'org-1', name: 'S' });
    const res = mockRes(); const next = vi.fn();
    await requireAgencyActor({ user: { role: 'owner', organisation_id: 'sub-1' } }, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Agency access required', code: 'AGENCY_ONLY' });
    expect(next).not.toHaveBeenCalled();

    const res2 = mockRes(); const next2 = vi.fn();
    await requireAgencyOwner(
      { user: { role: 'owner', organisation_id: 'x' }, agencyContext: { actorUserId: 'u', homeOrgId: 'org-1' } },
      res2, next2,
    );
    expect(next2).toHaveBeenCalledOnce();
  });

  it('fails closed (403) when the org lookup throws', async () => {
    orgMetaService.getOrgMeta.mockImplementation(async () => { throw new Error('db down'); });
    const res = mockRes(); const next = vi.fn();
    await requireAgencyActor({ user: { role: 'owner', organisation_id: 'org-1' }, log: { warn: vi.fn() } }, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
