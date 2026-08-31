// Deleting a sub-account is IRREVERSIBLE: organisations cascades every
// business table, so the practice's whole dataset goes with it. Two rails:
// the target must be a child of the caller's agency, and the caller must echo
// the org's exact name back (a mis-clicked id cannot destroy a tenant).
// Supabase auth users are deleted explicitly — the cascade only reaches
// public.users, and leftover auth rows are the known orphan problem.
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../src/repositories/agency.repository.js', () => ({
  agencyRepository: {
    childOrgs: vi.fn(),
    orgIntegrations: vi.fn(),
    featureRows: vi.fn(),
    upsertFeature: vi.fn(),
    setParent: vi.fn(),
    orgUserIds: vi.fn(),
    deleteOrg: vi.fn(),
  },
}));
vi.mock('../src/repositories/auth.repository.js', () => ({
  authRepository: { deleteAuthUser: vi.fn(async () => ({})) },
}));
vi.mock('../src/services/auth.service.js', () => ({ provisionOrgOwner: vi.fn() }));
vi.mock('../src/services/features.service.js', () => ({
  featuresService: { getEffectiveFeatures: vi.fn(async () => ({})), invalidate: vi.fn() },
}));
vi.mock('../src/services/org-meta.service.js', () => ({
  orgMetaService: { getOrgMeta: vi.fn(), invalidate: vi.fn(), getAgencyOrgId: vi.fn() },
}));

const { agencyRepository } = await import('../src/repositories/agency.repository.js');
const { authRepository } = await import('../src/repositories/auth.repository.js');
const { orgMetaService } = await import('../src/services/org-meta.service.js');
const { agencyService } = await import('../src/services/agency.service.js');

const AGENCY = 'agency-1';
const SUB = 'sub-1';
const NAME = 'gm dental Rochester';

beforeEach(() => {
  vi.clearAllMocks();
  agencyRepository.childOrgs.mockResolvedValue([{ id: SUB, name: NAME, created_at: 'x' }]);
  agencyRepository.orgUserIds.mockResolvedValue(['u1', 'u2']);
});

describe('deleteSubaccount', () => {
  it('refuses a target that is not our sub-account', async () => {
    agencyRepository.childOrgs.mockResolvedValue([]);
    await expect(agencyService.deleteSubaccount(AGENCY, SUB, NAME))
      .rejects.toMatchObject({ statusCode: 404 });
    expect(agencyRepository.deleteOrg).not.toHaveBeenCalled();
  });

  it('refuses when the confirmation name does not match', async () => {
    await expect(agencyService.deleteSubaccount(AGENCY, SUB, 'wrong name'))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(agencyRepository.deleteOrg).not.toHaveBeenCalled();
  });

  it('deletes the org and every auth identity, then clears the caches', async () => {
    const out = await agencyService.deleteSubaccount(AGENCY, SUB, NAME);
    // User ids must be read BEFORE the cascade removes public.users.
    expect(agencyRepository.orgUserIds.mock.invocationCallOrder[0])
      .toBeLessThan(agencyRepository.deleteOrg.mock.invocationCallOrder[0]);
    expect(agencyRepository.deleteOrg).toHaveBeenCalledWith(SUB);
    expect(authRepository.deleteAuthUser).toHaveBeenCalledWith('u1');
    expect(authRepository.deleteAuthUser).toHaveBeenCalledWith('u2');
    expect(orgMetaService.invalidate).toHaveBeenCalledWith(SUB);
    expect(out).toMatchObject({ deleted: SUB, users: 2 });
  });

  it('tolerates a whitespace/case difference in the confirmation', async () => {
    await expect(agencyService.deleteSubaccount(AGENCY, SUB, `  ${NAME.toUpperCase()} `))
      .resolves.toBeTruthy();
  });
});
