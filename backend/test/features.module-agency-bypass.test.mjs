// A disabled MODULE hides a product area from the tenant; it must not lock the
// AGENCY out of a sub-account it administers (the agency is the party that
// turned the module off, and still has to configure the account). Internal
// features are never bypassed — an org that lacks data_room/emergent/etc. must
// not expose that data just because an agency is looking at it.
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../src/services/features.service.js', () => ({
  featuresService: { orgHasFeature: vi.fn() },
}));
const { featuresService } = await import('../src/services/features.service.js');
const { requireFeature } = await import('../src/middleware/features.js');

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

const SWITCHED = { actorUserId: 'u1', homeOrgId: 'agency-1' };
const DENIED = { error: 'Feature not enabled', code: 'FEATURE_DISABLED' };

describe('requireFeature agency handling', () => {
  beforeEach(() => { featuresService.orgHasFeature.mockReset(); });

  it('agency actor reaches a DISABLED module without a lookup', async () => {
    featuresService.orgHasFeature.mockResolvedValue(false);
    const res = mockRes(); const next = vi.fn();
    await requireFeature('crm')(
      { user: { organisation_id: 'sub-1' }, agencyContext: SWITCHED }, res, next,
    );
    expect(next).toHaveBeenCalledOnce();
    expect(featuresService.orgHasFeature).not.toHaveBeenCalled();
  });

  it('agency actor is STILL denied a disabled internal feature', async () => {
    featuresService.orgHasFeature.mockResolvedValue(false);
    const res = mockRes(); const next = vi.fn();
    await requireFeature('data_room')(
      { user: { organisation_id: 'sub-1' }, agencyContext: SWITCHED }, res, next,
    );
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(DENIED);
    expect(featuresService.orgHasFeature).toHaveBeenCalledWith('sub-1', 'data_room');
  });

  it('a plain tenant owner is denied a disabled module', async () => {
    featuresService.orgHasFeature.mockResolvedValue(false);
    const res = mockRes(); const next = vi.fn();
    await requireFeature('crm')({ user: { organisation_id: 'sub-1' } }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(DENIED);
  });

  it('a plain tenant owner passes an enabled module', async () => {
    featuresService.orgHasFeature.mockResolvedValue(true);
    const res = mockRes(); const next = vi.fn();
    await requireFeature('crm')({ user: { organisation_id: 'sub-1' } }, res, next);
    expect(next).toHaveBeenCalledOnce();
  });
});
