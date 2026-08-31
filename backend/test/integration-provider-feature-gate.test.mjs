// Runtime feature gate on the generic multi-provider integration entry points.
// The three feature-bound providers (emergent, google_sheets,
// google_sheets_writer) have no static requireFeature on the generic routes —
// the provider arrives in req.body/req.params — so integration.service (and
// the two fire-and-forget controller paths) consult
// featuresService.orgHasProviderFeature at request time instead.
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../src/services/features.service.js', () => ({
  featuresService: { orgHasProviderFeature: vi.fn() },
}));

const { featuresService } = await import('../src/services/features.service.js');
const { integrationService } = await import('../src/services/integration.service.js');
const { integrationController } = await import('../src/controllers/integration.controller.js');

const ORG = 'org-1';
const DISABLED = { statusCode: 403, code: 'FEATURE_DISABLED' };

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

beforeEach(() => {
  featuresService.orgHasProviderFeature.mockReset();
});

describe('integrationService feature gate (flag off)', () => {
  beforeEach(() => featuresService.orgHasProviderFeature.mockResolvedValue(false));

  it('startConnect rejects 403 FEATURE_DISABLED', async () => {
    await expect(integrationService.startConnect(ORG, 'emergent')).rejects.toMatchObject(DISABLED);
    expect(featuresService.orgHasProviderFeature).toHaveBeenCalledWith(ORG, 'emergent');
  });

  it('finishConnect rejects 403 FEATURE_DISABLED', async () => {
    await expect(integrationService.finishConnect(ORG, 'google_sheets', {})).rejects.toMatchObject(DISABLED);
  });

  it('refresh rejects 403 FEATURE_DISABLED', async () => {
    await expect(integrationService.refresh(ORG, 'google_sheets_writer')).rejects.toMatchObject(DISABLED);
  });

  it('webhookInfo rejects 403 FEATURE_DISABLED', async () => {
    await expect(integrationService.webhookInfo(ORG, 'emergent')).rejects.toMatchObject(DISABLED);
  });

  it('setWebhookSecret rejects 403 FEATURE_DISABLED', async () => {
    await expect(integrationService.setWebhookSecret(ORG, 'emergent', 'shh')).rejects.toMatchObject(DISABLED);
  });

  it('syncNow skips quietly (feature_disabled marker) so syncAll fire-and-forget never marks the row failed', async () => {
    const result = await integrationService.syncNow(ORG, 'emergent');
    expect(result).toMatchObject({ skipped: 'feature_disabled', provider: 'emergent' });
  });

  it('revoke is deliberately NOT gated — a disabled org can still disconnect', async () => {
    try { await integrationService.revoke(ORG, 'emergent'); } catch { /* impl may throw; the gate is the assertion */ }
    expect(featuresService.orgHasProviderFeature).not.toHaveBeenCalled();
  });
});

describe('integrationService feature gate (flag on)', () => {
  it('syncNow proceeds past the gate to the normal capability check', async () => {
    featuresService.orgHasProviderFeature.mockResolvedValue(true);
    // emergent has no on-demand syncer, so the pre-existing 400 fires next —
    // proving the gate passed through rather than short-circuiting.
    await expect(integrationService.syncNow(ORG, 'emergent')).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('integrationController fire-and-forget paths (flag off)', () => {
  beforeEach(() => featuresService.orgHasProviderFeature.mockResolvedValue(false));

  it('sync responds 403 FEATURE_DISABLED before firing syncNow', async () => {
    const spy = vi.spyOn(integrationService, 'syncNow');
    const res = mockRes();
    await integrationController.sync(
      { params: { provider: 'emergent' }, body: {}, query: {}, user: { organisation_id: ORG } },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Feature not enabled', code: 'FEATURE_DISABLED' });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('syncProgress responds 403 FEATURE_DISABLED', async () => {
    const res = mockRes();
    await integrationController.syncProgress(
      { params: { provider: 'emergent' }, user: { organisation_id: ORG } },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Feature not enabled', code: 'FEATURE_DISABLED' });
  });
});
