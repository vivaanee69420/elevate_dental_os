import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/services/features.service.js', () => ({
  featuresService: { enabledKeys: vi.fn().mockResolvedValue(['finance', 'crm', 'data_room']) },
}));
vi.mock('../src/services/auth.service.js', () => ({
  authService: { organisationName: vi.fn().mockResolvedValue('Test Org') },
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
});
