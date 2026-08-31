// Agency lifecycle service: child validation on every targeted call, owner
// provisioning reuses provisionOrgOwner (platform temp-password contract),
// feature toggles invalidate the A1 cache, switch mints a user-bound token.
import { describe, it, expect, beforeEach, vi } from 'vitest';

process.env.OAUTH_STATE_SECRET ||= 'test-secret';

vi.mock('../src/repositories/agency.repository.js', () => ({
  agencyRepository: {
    childOrgs: vi.fn(), orgIntegrations: vi.fn(), featureRows: vi.fn(),
    upsertFeature: vi.fn(), setParent: vi.fn(), createOrg: vi.fn(),
    listOrgUsers: vi.fn(), orgUserIds: vi.fn(), deleteOrg: vi.fn(),
  },
}));
vi.mock('../src/repositories/auth.repository.js', () => ({
  authRepository: { deleteAuthUser: vi.fn(), findUserByEmail: vi.fn(async () => null) },
}));
vi.mock('../src/repositories/membership.repository.js', () => ({
  membershipRepository: { add: vi.fn(), find: vi.fn(), remove: vi.fn(), listForUser: vi.fn() },
}));
vi.mock('../src/services/auth.service.js', () => ({
  authService: { provisionMember: vi.fn(async () => ({ success: true, user_id: 'new-user' })) },
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
const { authService } = await import('../src/services/auth.service.js');
const { authRepository } = await import('../src/repositories/auth.repository.js');
const { membershipRepository } = await import('../src/repositories/membership.repository.js');
const { featuresService } = await import('../src/services/features.service.js');
const { orgMetaService } = await import('../src/services/org-meta.service.js');
const { agencyService } = await import('../src/services/agency.service.js');
const { verifySwitchToken } = await import('../src/lib/agency-switch.js');

const AGENCY = 'agency-1';
const SUB = 'sub-1';

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks clears CALLS, not implementations — reset the default so a
  // test that stubs an existing login doesn't leak into the next one.
  authRepository.findUserByEmail.mockResolvedValue(null);
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
  beforeEach(() => {
    agencyRepository.createOrg.mockResolvedValue({
      data: { id: 'sub-new', name: 'New Practice', created_at: 'x' }, error: null,
    });
  });

  it('creates the ORGANISATION only — no owner, no temporary password', async () => {
    const out = await agencyService.createSubaccount(AGENCY, { organisation_name: 'New Practice' });
    expect(agencyRepository.createOrg).toHaveBeenCalledWith('New Practice', 'new-practice', AGENCY);
    expect(out).toEqual({ organisation_id: 'sub-new', name: 'New Practice' });
    expect(out.temp_password).toBeUndefined();
    expect(orgMetaService.invalidate).toHaveBeenCalledWith('sub-new');
  });

  it('retries with a suffixed slug when the name collides', async () => {
    agencyRepository.createOrg
      .mockResolvedValueOnce({ data: null, error: { code: '23505', message: 'duplicate' } })
      .mockResolvedValueOnce({ data: { id: 'sub-new', name: 'New Practice' }, error: null });
    await agencyService.createSubaccount(AGENCY, { organisation_name: 'New Practice' });
    const second = agencyRepository.createOrg.mock.calls[1];
    expect(second[1]).toMatch(/^new-practice-[a-z0-9]{6}$/);
  });
});

describe('addSubaccountUser', () => {
  it('refuses a non-child target before creating anything', async () => {
    agencyRepository.childOrgs.mockResolvedValue([]);
    await expect(agencyService.addSubaccountUser(AGENCY, SUB, { id: 'actor' }, {
      email: 'u@s.dev', full_name: 'U', password: 'permanent-pw', role: 'owner',
    })).rejects.toMatchObject({ statusCode: 404 });
    expect(authService.provisionMember).not.toHaveBeenCalled();
  });

  it('links an EXISTING email as a membership instead of failing', async () => {
    // The point of the membership model: one person, several accounts, one
    // password. Previously this threw "This email is already a member".
    authRepository.findUserByEmail.mockResolvedValue({ id: 'existing-user', email: 'u@s.dev' });
    const out = await agencyService.addSubaccountUser(AGENCY, SUB, { id: 'actor' }, {
      email: 'u@s.dev', full_name: 'U', password: 'irrelevant', role: 'reception',
    });
    expect(membershipRepository.add).toHaveBeenCalledWith('existing-user', SUB, 'reception', {});
    expect(authService.provisionMember).not.toHaveBeenCalled(); // no second login
    expect(out).toMatchObject({ user_id: 'existing-user', linked: true });
  });

  it('gives a NEW login its membership row too, so the picker sees it', async () => {
    await agencyService.addSubaccountUser(AGENCY, SUB, { id: 'actor' }, {
      email: 'new@s.dev', full_name: 'N', password: 'permanent-pw', role: 'owner',
    });
    expect(membershipRepository.add).toHaveBeenCalledWith('new-user', SUB, 'owner', {});
  });

  it('adds the user to the SUB-ACCOUNT org, isolating them there', async () => {
    const out = await agencyService.addSubaccountUser(AGENCY, SUB, { id: 'actor' }, {
      email: 'u@s.dev', full_name: 'U', password: 'permanent-pw', role: 'practice_manager',
    });
    const [orgArg, callerArg, bodyArg] = authService.provisionMember.mock.calls[0];
    expect(orgArg).toBe(SUB);                    // NOT the agency org
    expect(callerArg.role).toBe('owner');        // agency acts at the org's ceiling
    expect(bodyArg).toMatchObject({ email: 'u@s.dev', role: 'practice_manager' });
    expect(out.user_id).toBe('new-user');
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
