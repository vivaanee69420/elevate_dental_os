import { describe, it, expect, vi, beforeEach } from 'vitest';
import './setup.js';

vi.mock('../src/repositories/auth.repository.js', () => ({
  authRepository: { getUserInOrgs: vi.fn(), updateMember: vi.fn(async () => {}) },
}));
vi.mock('../src/repositories/membership.repository.js', () => ({
  membershipRepository: {
    listForUser: vi.fn(async () => []),
    add: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    addMany: vi.fn(async () => {}),
    removeMany: vi.fn(async () => {}),
  },
}));
vi.mock('../src/repositories/agency.repository.js', () => ({
  agencyRepository: { childOrgs: vi.fn(async () => []), orgNames: vi.fn(async () => new Map()) },
}));
vi.mock('../src/services/permissions.service.js', () => ({
  permissionsService: { getEffectiveForUser: vi.fn(async () => ({})) },
}));

const { authRepository } = await import('../src/repositories/auth.repository.js');
const { membershipRepository } = await import('../src/repositories/membership.repository.js');
const { teamService } = await import('../src/services/team.service.js');

const AGENCY_SCOPE = {
  orgIds: ['agency-1', 'child-1', 'child-2'], agencyWide: true, agencyOrgId: 'agency-1',
};
const OWNER = { id: 'caller', role: 'owner', permissions: {} };
const TARGET = {
  id: 'u1', organisation_id: 'child-1', email: 'a@x.dev', full_name: 'A', phone: null,
  role: 'reception', status: 'active', is_agency_admin: false, last_active_at: null,
  permissions: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  authRepository.getUserInOrgs.mockResolvedValue({ ...TARGET });
  membershipRepository.listForUser.mockResolvedValue([
    { organisation_id: 'child-1', name: 'Rye', role: 'reception', permissions: {} },
  ]);
});

describe('teamService.save — account assignment', () => {
  it('404s an organisation that is not one this caller administers', async () => {
    await expect(teamService.save(AGENCY_SCOPE, OWNER, 'u1', {
      organisation_ids: ['child-1', 'someone-elses-org'],
    })).rejects.toThrow(/sub-account/i);
    expect(membershipRepository.addMany).not.toHaveBeenCalled();
    // Nothing is written at all — the whole save is refused, not half-applied.
    expect(authRepository.updateMember).not.toHaveBeenCalled();
  });

  it('refuses to drop the home account — the person could not sign in', async () => {
    await expect(teamService.save(AGENCY_SCOPE, OWNER, 'u1', {
      organisation_ids: ['child-2'],
    })).rejects.toThrow(/home account/i);
    expect(membershipRepository.removeMany).not.toHaveBeenCalled();
  });

  it('writes the SAME role and permissions to every assigned account', async () => {
    await teamService.save(AGENCY_SCOPE, OWNER, 'u1', {
      role: 'practice_manager',
      permissions: { 'growth.view': true },
      organisation_ids: ['child-1', 'child-2'],
    });
    expect(membershipRepository.addMany).toHaveBeenCalledTimes(1);
    expect(membershipRepository.addMany).toHaveBeenCalledWith([
      { user_id: 'u1', organisation_id: 'child-1', role: 'practice_manager', permissions: { 'growth.view': true } },
      { user_id: 'u1', organisation_id: 'child-2', role: 'practice_manager', permissions: { 'growth.view': true } },
    ]);
  });

  it('removes a membership the new list drops', async () => {
    membershipRepository.listForUser.mockResolvedValueOnce([
      { organisation_id: 'child-1', name: 'Rye', role: 'reception', permissions: {} },
      { organisation_id: 'child-2', name: 'Barnet', role: 'reception', permissions: {} },
    ]);
    await teamService.save(AGENCY_SCOPE, OWNER, 'u1', { organisation_ids: ['child-1'] });
    expect(membershipRepository.removeMany).toHaveBeenCalledWith('u1', ['child-2']);
    expect(membershipRepository.removeMany).toHaveBeenCalledTimes(1);
  });

  it('never removes a membership of an org outside the administered scope', async () => {
    membershipRepository.listForUser.mockResolvedValueOnce([
      { organisation_id: 'child-1', name: 'Rye', role: 'reception', permissions: {} },
      { organisation_id: 'unrelated-org', name: 'Elsewhere', role: 'owner', permissions: {} },
    ]);
    await teamService.save(AGENCY_SCOPE, OWNER, 'u1', { organisation_ids: ['child-1'] });
    // Sharper than "not called": the unrelated org must not even appear in
    // the list handed to removeMany, which is the batch equivalent of never
    // calling remove() for it.
    expect(membershipRepository.removeMany).toHaveBeenCalledWith('u1', []);
  });

  it('falls back to the target existing role when the save does not change it', async () => {
    await teamService.save(AGENCY_SCOPE, OWNER, 'u1', { organisation_ids: ['child-1'] });
    expect(membershipRepository.addMany).toHaveBeenCalledWith([
      { user_id: 'u1', organisation_id: 'child-1', role: 'reception', permissions: {} },
    ]);
  });

  it('dedupes duplicate ids in organisation_ids to one row per account', async () => {
    await teamService.save(AGENCY_SCOPE, OWNER, 'u1', {
      organisation_ids: ['child-1', 'child-2', 'child-2'],
    });
    expect(membershipRepository.addMany).toHaveBeenCalledTimes(1);
    const rows = membershipRepository.addMany.mock.calls[0][0];
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(expect.arrayContaining([
      { user_id: 'u1', organisation_id: 'child-1', role: 'reception', permissions: {} },
      { user_id: 'u1', organisation_id: 'child-2', role: 'reception', permissions: {} },
    ]));
  });
});
