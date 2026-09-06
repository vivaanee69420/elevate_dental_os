// Remove and Set password across the administered orgs.
//
// The agency-wide team list renders a Remove button on EVERY row, including
// rows that belong to a sub-account. Both endpoints used to hand authService
// the CALLER's organisation_id, and authService resolves its target with
// getUserInOrg(orgId, id) — so every sub-account row's Remove and Set-password
// answered "Member not found in this organisation" and nothing else could
// happen. Resolve the target against the administered orgs, then pass the org
// the target actually sits in.
//
// The self-check and the role hierarchy stay in authService: these tests pin
// that this layer DELEGATES rather than re-implements them.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import './setup.js';

vi.mock('../src/repositories/auth.repository.js', () => ({
  authRepository: { getUserInOrgs: vi.fn(async () => null), updateMember: vi.fn(async () => {}) },
}));
vi.mock('../src/repositories/membership.repository.js', () => ({
  membershipRepository: {
    listForUser: vi.fn(async () => []),
    listForUsers: vi.fn(async () => new Map()),
    addMany: vi.fn(async () => {}),
    removeMany: vi.fn(async () => {}),
  },
}));
vi.mock('../src/repositories/agency.repository.js', () => ({
  agencyRepository: { childOrgs: vi.fn(async () => []), orgNames: vi.fn(async () => new Map()) },
}));
vi.mock('../src/services/permissions.service.js', () => ({
  permissionsService: {
    getEffectiveForUser: vi.fn(async () => ({})),
    getMatrix: vi.fn(async () => ({ catalog: {}, roles: {}, pages: {}, overrides: {} })),
  },
}));
vi.mock('../src/services/auth.service.js', () => ({
  authService: {
    removeMember: vi.fn(async () => ({ success: true })),
    setMemberPassword: vi.fn(async () => ({ success: true })),
    provisionMember: vi.fn(async () => ({ success: true, user_id: 'new-1', status: 'active' })),
    invite: vi.fn(async () => ({ success: true, user_id: 'new-1', status: 'invited' })),
  },
  canManageTarget: () => true,
  assertGrantCeiling: () => {},
}));

const { authRepository } = await import('../src/repositories/auth.repository.js');
const { authService } = await import('../src/services/auth.service.js');
const { teamService } = await import('../src/services/team.service.js');

const AGENCY_SCOPE = { orgIds: ['agency-1', 'sub-1'], agencyWide: true, agencyOrgId: 'agency-1' };
const CALLER = { id: 'owner-1', organisation_id: 'agency-1', role: 'owner' };

beforeEach(() => vi.clearAllMocks());

describe('teamService.remove', () => {
  it('passes the TARGET org to authService, not the caller org', async () => {
    authRepository.getUserInOrgs.mockResolvedValueOnce({
      id: 'u-9', organisation_id: 'sub-1', role: 'reception',
    });
    const out = await teamService.remove(AGENCY_SCOPE, CALLER, 'u-9');
    expect(authRepository.getUserInOrgs).toHaveBeenCalledWith(['agency-1', 'sub-1'], 'u-9');
    expect(authService.removeMember).toHaveBeenCalledWith('sub-1', CALLER, 'u-9');
    expect(out).toEqual({ success: true, organisation_id: 'sub-1' });
  });

  it('404s a user outside the administered orgs, without touching authService', async () => {
    authRepository.getUserInOrgs.mockResolvedValueOnce(null);
    await expect(teamService.remove(AGENCY_SCOPE, CALLER, 'u-other')).rejects.toThrow(/not found/i);
    expect(authService.removeMember).not.toHaveBeenCalled();
  });

  it('lets authService own the self and hierarchy refusals rather than duplicating them', async () => {
    authRepository.getUserInOrgs.mockResolvedValueOnce({
      id: 'owner-1', organisation_id: 'agency-1', role: 'owner',
    });
    authService.removeMember.mockRejectedValueOnce(new Error('You cannot remove yourself'));
    await expect(teamService.remove(AGENCY_SCOPE, CALLER, 'owner-1'))
      .rejects.toThrow(/cannot remove yourself/i);
  });
});

describe('teamService.setPassword', () => {
  it('passes the TARGET org to authService, not the caller org', async () => {
    authRepository.getUserInOrgs.mockResolvedValueOnce({
      id: 'u-9', organisation_id: 'sub-1', role: 'reception',
    });
    const out = await teamService.setPassword(AGENCY_SCOPE, CALLER, 'u-9', 'hunter2hunter2');
    expect(authService.setMemberPassword)
      .toHaveBeenCalledWith('sub-1', CALLER, 'u-9', 'hunter2hunter2');
    expect(out).toEqual({ success: true, organisation_id: 'sub-1' });
  });

  it('404s a user outside the administered orgs, without touching authService', async () => {
    authRepository.getUserInOrgs.mockResolvedValueOnce(null);
    await expect(
      teamService.setPassword(AGENCY_SCOPE, CALLER, 'u-other', 'hunter2hunter2'),
    ).rejects.toThrow(/not found/i);
    expect(authService.setMemberPassword).not.toHaveBeenCalled();
  });

  it('a plain owner sees exactly their own org in scope', async () => {
    const own = { orgIds: ['org-1'], agencyWide: false, agencyOrgId: null };
    authRepository.getUserInOrgs.mockResolvedValueOnce({
      id: 'u-2', organisation_id: 'org-1', role: 'reception',
    });
    await teamService.setPassword(own, { ...CALLER, organisation_id: 'org-1' }, 'u-2', 'pw12345678');
    expect(authRepository.getUserInOrgs).toHaveBeenCalledWith(['org-1'], 'u-2');
    expect(authService.setMemberPassword.mock.calls[0][0]).toBe('org-1');
  });
});
