// backend/test/features.middleware.test.mjs
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

describe('requireFeature', () => {
  let res; let next;
  beforeEach(() => {
    res = mockRes();
    next = vi.fn();
    featuresService.orgHasFeature.mockReset();
  });

  it('throws at wire-time for a key not in the catalog', () => {
    expect(() => requireFeature('nope')).toThrow(/unknown feature key/);
  });

  it('exposes the key for structural route tests', () => {
    expect(requireFeature('data_room').featureKey).toBe('data_room');
  });

  it('passes when the org has the feature', async () => {
    featuresService.orgHasFeature.mockResolvedValue(true);
    await requireFeature('data_room')({ user: { organisation_id: 'org-1' } }, res, next);
    expect(featuresService.orgHasFeature).toHaveBeenCalledWith('org-1', 'data_room');
    expect(next).toHaveBeenCalledOnce();
  });

  it('403s FEATURE_DISABLED when the org lacks it', async () => {
    featuresService.orgHasFeature.mockResolvedValue(false);
    await requireFeature('emergent')({ user: { organisation_id: 'org-2' } }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Feature not enabled', code: 'FEATURE_DISABLED' });
  });

  it('403s when there is no req.user', async () => {
    await requireFeature('data_room')({}, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
