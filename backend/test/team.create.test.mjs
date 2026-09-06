import { describe, it, expect, vi, beforeEach } from 'vitest';
import './setup.js';

vi.mock('../src/repositories/auth.repository.js', () => ({
  authRepository: { getUserInOrgs: vi.fn(), updateMember: vi.fn(async () => {}) },
}));
vi.mock('../src/repositories/membership.repository.js', () => ({
  membershipRepository: {
    listForUser: vi.fn(async () => []), addMany: vi.fn(async () => {}), removeMany: vi.fn(async () => {}),
  },
}));
vi.mock('../src/repositories/agency.repository.js', () => ({
  agencyRepository: { childOrgs: vi.fn(async () => []), orgNames: vi.fn(async () => new Map()) },
}));
vi.mock('../src/services/permissions.service.js', () => ({
  permissionsService: { getEffectiveForUser: vi.fn(async () => ({})) },
}));
vi.mock('../src/services/auth.service.js', async (orig) => {
  const actual = await orig();
  return {
    ...actual,
    authService: {
      provisionMember: vi.fn(async () => ({ success: true, user_id: 'new-1', status: 'active' })),
      invite: vi.fn(async () => ({ success: true, user_id: 'new-2', status: 'invited' })),
    },
  };
});

const { authService } = await import('../src/services/auth.service.js');
const { membershipRepository } = await import('../src/repositories/membership.repository.js');
const { teamService } = await import('../src/services/team.service.js');

const OWN_SCOPE = { orgIds: ['org-1'], agencyWide: false, agencyOrgId: null };
const AGENCY_SCOPE = { orgIds: ['agency-1', 'child-1'], agencyWide: true, agencyOrgId: 'agency-1' };
const OWNER = { id: 'caller', role: 'owner', permissions: {} };

beforeEach(() => vi.clearAllMocks());

describe('teamService.create', () => {
  it('provisions into the caller own org when no account is named', async () => {
    const out = await teamService.create(OWN_SCOPE, OWNER, {
      email: 'new@x.dev', full_name: 'New Person', role: 'reception', password: 'longenough1',
    });
    expect(authService.provisionMember).toHaveBeenCalledWith('org-1', OWNER, expect.objectContaining({
      email: 'new@x.dev', role: 'reception', password: 'longenough1',
    }));
    expect(out.user_id).toBe('new-1');
  });

  it('an agency admin can create the user inside a sub-account', async () => {
    await teamService.create(AGENCY_SCOPE, OWNER, {
      email: 'new@x.dev', full_name: 'New Person', role: 'reception', password: 'longenough1',
      home_organisation_id: 'child-1',
    });
    expect(authService.provisionMember).toHaveBeenCalledWith('child-1', OWNER, expect.anything());
  });

  it('refuses a home account outside the administered orgs', async () => {
    await expect(teamService.create(AGENCY_SCOPE, OWNER, {
      email: 'new@x.dev', full_name: 'N', role: 'reception', password: 'longenough1',
      home_organisation_id: 'not-mine',
    })).rejects.toThrow(/sub-account/i);
    expect(authService.provisionMember).not.toHaveBeenCalled();
  });

  it('refuses a non-agency caller naming any home account but their own', async () => {
    await expect(teamService.create(OWN_SCOPE, OWNER, {
      email: 'new@x.dev', full_name: 'N', role: 'reception', password: 'longenough1',
      home_organisation_id: 'org-2',
    })).rejects.toThrow(/sub-account/i);
  });

  it('assigns the extra accounts after creating the login', async () => {
    await teamService.create(AGENCY_SCOPE, OWNER, {
      email: 'new@x.dev', full_name: 'N', role: 'reception', password: 'longenough1',
      home_organisation_id: 'child-1', organisation_ids: ['child-1', 'agency-1'],
    });
    // Task 4 replaced the one-row-at-a-time add() loop with a single
    // batched addMany() — this is one call whose rows array carries both
    // accounts, not two separate add() calls.
    expect(membershipRepository.addMany).toHaveBeenCalledTimes(1);
    expect(membershipRepository.addMany).toHaveBeenCalledWith([
      { user_id: 'new-1', organisation_id: 'child-1', role: 'reception', permissions: {} },
      { user_id: 'new-1', organisation_id: 'agency-1', role: 'reception', permissions: {} },
    ]);
  });

  it('rejects a stale/mistyped account id BEFORE creating the login', async () => {
    // The check has to run ahead of provisionMember/invite, not just before
    // the eventual applyAccounts() write inside it — by the time
    // applyAccounts would catch this, the login is already committed and
    // the caller's 404 would be a lie about what happened.
    await expect(teamService.create(AGENCY_SCOPE, OWNER, {
      email: 'new@x.dev', full_name: 'N', role: 'reception', password: 'longenough1',
      home_organisation_id: 'child-1', organisation_ids: ['child-1', 'not-mine'],
    })).rejects.toThrow(/sub-account/i);
    expect(authService.provisionMember).not.toHaveBeenCalled();
    expect(membershipRepository.addMany).not.toHaveBeenCalled();
  });

  it('rejects an account list that omits the home org BEFORE creating the login', async () => {
    await expect(teamService.create(AGENCY_SCOPE, OWNER, {
      email: 'new@x.dev', full_name: 'N', role: 'reception', password: 'longenough1',
      home_organisation_id: 'child-1', organisation_ids: ['agency-1'],
    })).rejects.toThrow(/home account/i);
    expect(authService.provisionMember).not.toHaveBeenCalled();
    expect(membershipRepository.addMany).not.toHaveBeenCalled();
  });

  it('records the home membership even when no organisation_ids is given', async () => {
    // R10: provisionMember/invite never write user_organisations, so without
    // this a user created here would start with no membership row at all —
    // the same gap Tasks 1-2 had to paper over by seeding `accounts` from
    // the users row. This screen must not repeat it.
    await teamService.create(OWN_SCOPE, OWNER, {
      email: 'new@x.dev', full_name: 'New Person', role: 'reception', password: 'longenough1',
    });
    expect(membershipRepository.addMany).toHaveBeenCalledWith([
      { user_id: 'new-1', organisation_id: 'org-1', role: 'reception', permissions: {} },
    ]);
  });

  it('uses the invite path when no password is given', async () => {
    const out = await teamService.create(OWN_SCOPE, OWNER, {
      email: 'new@x.dev', full_name: 'N', role: 'reception',
    });
    expect(authService.invite).toHaveBeenCalled();
    expect(authService.provisionMember).not.toHaveBeenCalled();
    expect(out.status).toBe('invited');
  });
});
