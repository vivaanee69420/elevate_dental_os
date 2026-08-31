// Agency lifecycle service: child validation on every targeted call, owner
// provisioning reuses provisionOrgOwner (platform temp-password contract),
// feature toggles invalidate the A1 cache, switch mints a user-bound token.
import { describe, it, expect, beforeEach, vi } from 'vitest';

process.env.OAUTH_STATE_SECRET ||= 'test-secret';

vi.mock('../src/repositories/agency.repository.js', () => ({
  agencyRepository: {
    childOrgs: vi.fn(), orgIntegrations: vi.fn(), featureRows: vi.fn(),
    upsertFeature: vi.fn(), setParent: vi.fn(),
  },
}));
vi.mock('../src/services/auth.service.js', () => ({
  provisionOrgOwner: vi.fn(async () => ({ organisation_id: 'sub-new', owner_id: 'owner-new' })),
}));
vi.mock('../src/services/features.service.js', () => ({
  featuresService: {
    getEffectiveFeatures: vi.fn(async () => ({ data_room: false, crm: true })),
    invalidate: vi.fn(),
  },
}));
vi.mock('../src/services/org-meta.service.js', () => ({
  orgMetaService: { getOrgMeta: vi.fn(), invalidate: vi.fn() },
}));

const { agencyRepository } = await import('../src/repositories/agency.repository.js');
const { provisionOrgOwner } = await import('../src/services/auth.service.js');
const { featuresService } = await import('../src/services/features.service.js');
const { orgMetaService } = await import('../src/services/org-meta.service.js');
const { agencyService } = await import('../src/services/agency.service.js');
const { verifySwitchToken } = await import('../src/lib/agency-switch.js');

const AGENCY = 'agency-1';
const SUB = 'sub-1';

beforeEach(() => {
  vi.clearAllMocks();
  agencyRepository.childOrgs.mockResolvedValue([{ id: SUB, name: 'Bexley Dental', created_at: '2026-08-31' }]);
  agencyRepository.orgIntegrations.mockResolvedValue([{ organisation_id: SUB, provider: 'dentally', status: 'active' }]);
  agencyRepository.featureRows.mockResolvedValue([]);
});

describe('listSubaccounts', () => {
  it('joins children with integration summary and effective features', async () => {
    const { subaccounts } = await agencyService.listSubaccounts(AGENCY);
    expect(subaccounts).toEqual([expect.objectContaining({
      id: SUB, name: 'Bexley Dental',
      integrations: [{ provider: 'dentally', status: 'active' }],
      features: { data_room: false, crm: true },
    })]);
    expect(agencyRepository.childOrgs).toHaveBeenCalledWith(AGENCY);
  });
});

describe('createSubaccount', () => {
  it('provisions an ACTIVE owner, stamps the parent, returns the one-time temp password', async () => {
    const out = await agencyService.createSubaccount(AGENCY, {
      organisation_name: 'New Practice', owner_email: 'o@np.dev', owner_name: 'Own Er',
    });
    expect(provisionOrgOwner).toHaveBeenCalledWith(
      expect.objectContaining({
        organisation_name: 'New Practice', email: 'o@np.dev', full_name: 'Own Er',
        password: expect.any(String),
      }),
      'active',
    );
    expect(agencyRepository.setParent).toHaveBeenCalledWith('sub-new', AGENCY);
    expect(orgMetaService.invalidate).toHaveBeenCalledWith('sub-new');
    expect(out.temp_password.length).toBeGreaterThanOrEqual(12);
    expect(out.organisation_id).toBe('sub-new');
  });
});

describe('subaccountFeatures', () => {
  it('returns effective features + raw overrides for a child', async () => {
    agencyRepository.featureRows.mockResolvedValue([{ feature: 'data_room', enabled: false }]);
    const out = await agencyService.subaccountFeatures(AGENCY, SUB);
    expect(out.features).toEqual({ data_room: false, crm: true });
    expect(out.overrides).toEqual([{ feature: 'data_room', enabled: false }]);
  });
});

describe('setSubaccountFeature', () => {
  it('rejects a non-child target with 404', async () => {
    agencyRepository.childOrgs.mockResolvedValue([]);
    await expect(agencyService.setSubaccountFeature(AGENCY, SUB, { feature: 'crm', enabled: false }))
      .rejects.toMatchObject({ statusCode: 404 });
    expect(agencyRepository.upsertFeature).not.toHaveBeenCalled();
  });

  it('upserts and invalidates the features cache for the child', async () => {
    await agencyService.setSubaccountFeature(AGENCY, SUB, { feature: 'crm', enabled: false });
    expect(agencyRepository.upsertFeature).toHaveBeenCalledWith(SUB, 'crm', false);
    expect(featuresService.invalidate).toHaveBeenCalledWith(SUB);
  });
});

describe('switch', () => {
  it('mints a user-bound token for a child org', async () => {
    const out = await agencyService.switch(AGENCY, 'user-1', SUB);
    expect(verifySwitchToken(out.token)).toEqual({ userId: 'user-1', orgId: SUB });
    expect(out.organisation).toEqual({ id: SUB, name: 'Bexley Dental' });
    expect(typeof out.expires_at).toBe('string');
  });

  it('refuses a non-child org', async () => {
    agencyRepository.childOrgs.mockResolvedValue([]);
    await expect(agencyService.switch(AGENCY, 'user-1', SUB)).rejects.toMatchObject({ statusCode: 404 });
  });
});
