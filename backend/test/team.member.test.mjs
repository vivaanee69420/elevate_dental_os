// One member for the editor: profile, role, memberships, effective
// permissions, and which of those are explicit overrides rather than
// inherited from the role.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import './setup.js';

vi.mock('../src/repositories/auth.repository.js', () => ({
  authRepository: { getUserInOrgs: vi.fn(async () => null) },
}));
vi.mock('../src/repositories/membership.repository.js', () => ({
  membershipRepository: { listForUser: vi.fn(async () => []) },
}));
vi.mock('../src/repositories/agency.repository.js', () => ({
  agencyRepository: { childOrgs: vi.fn(async () => []), orgNames: vi.fn(async () => new Map()) },
}));
vi.mock('../src/services/permissions.service.js', () => ({
  permissionsService: {
    getEffectiveForUser: vi.fn(async () => ({ 'crm.view': true, 'finance.view': false })),
    getMatrix: vi.fn(async () => ({
      catalog: {},
      roles: { reception: { 'crm.view': true }, owner: { 'crm.view': true } },
      pages: {},
      overrides: {},
    })),
  },
}));

const { authRepository } = await import('../src/repositories/auth.repository.js');
const { membershipRepository } = await import('../src/repositories/membership.repository.js');
const { agencyRepository } = await import('../src/repositories/agency.repository.js');
const { permissionsService } = await import('../src/services/permissions.service.js');
const { teamService } = await import('../src/services/team.service.js');

const SCOPE = { orgIds: ['org-1'], agencyWide: false, agencyOrgId: null };

beforeEach(() => vi.clearAllMocks());

describe('teamService.get', () => {
  it('404s a user outside the administered orgs', async () => {
    authRepository.getUserInOrgs.mockResolvedValueOnce(null);
    await expect(teamService.get(SCOPE, 'u-other')).rejects.toThrow(/not found/i);
    expect(authRepository.getUserInOrgs).toHaveBeenCalledWith(['org-1'], 'u-other');
  });

  it('separates explicit overrides from the effective map', async () => {
    authRepository.getUserInOrgs.mockResolvedValueOnce({
      id: 'u1', organisation_id: 'org-1', email: 'a@x.dev', full_name: 'A', phone: null,
      role: 'practice_manager', status: 'active', is_agency_admin: false,
      last_active_at: null, permissions: { 'finance.view': false },
    });
    const out = await teamService.get(SCOPE, 'u1');
    expect(out.overrides).toEqual({ 'finance.view': false });
    expect(out.effective).toEqual({ 'crm.view': true, 'finance.view': false });
    expect(out.member.role).toBe('practice_manager');
    // The raw JSONB must not travel back inside `member` as well — one
    // representation of the overrides, not two that can disagree.
    expect(out.member.permissions).toBeUndefined();
  });

  it('unions in-scope memberships with the home org, skipping anything outside the administered orgs', async () => {
    authRepository.getUserInOrgs.mockResolvedValueOnce({
      id: 'u1', organisation_id: 'org-1', email: 'a@x.dev', full_name: 'A', phone: null,
      role: 'owner', status: 'active', is_agency_admin: false, last_active_at: null, permissions: {},
    });
    membershipRepository.listForUser.mockResolvedValueOnce([
      { organisation_id: 'org-1', name: 'Mine', role: 'owner', permissions: {} },
      { organisation_id: 'org-2', name: 'Also mine', role: 'practice_manager', permissions: {} },
      { organisation_id: 'org-elsewhere', name: 'Not mine', role: 'reception', permissions: {} },
    ]);
    agencyRepository.orgNames.mockResolvedValueOnce(new Map([['org-1', 'Home']]));
    const scope = { orgIds: ['org-1', 'org-2'], agencyWide: true, agencyOrgId: 'org-1' };
    const out = await teamService.get(scope, 'u1');
    expect(out.accounts).toEqual([
      { id: 'org-1', name: 'Home', role: 'owner' },
      { id: 'org-2', name: 'Also mine', role: 'practice_manager' },
    ]);
  });

  it('a member with no membership rows still reports their home org', async () => {
    // user_organisations is additive and provisionMember/invite never write a
    // row to it, so a user onboarded since the backfill has none —
    // membershipRepository.listForUser resolves the default empty array.
    authRepository.getUserInOrgs.mockResolvedValueOnce({
      id: 'u1', organisation_id: 'org-1', email: 'a@x.dev', full_name: 'A', phone: null,
      role: 'owner', status: 'active', is_agency_admin: false, last_active_at: null, permissions: {},
    });
    agencyRepository.orgNames.mockResolvedValueOnce(new Map([['org-1', 'Home']]));
    const out = await teamService.get(SCOPE, 'u1');
    expect(out.accounts).toEqual([{ id: 'org-1', name: 'Home', role: 'owner' }]);
  });

  // role_permissions is per-organisation, so the defaults an unpinned row
  // previews against belong to the TARGET's account, not the caller's. An
  // agency admin sits in org-1 and edits someone in org-2: the reset control
  // must preview org-2's answer, which is the one the save will write.
  it('resolves role defaults for the TARGET org, not the caller org', async () => {
    authRepository.getUserInOrgs.mockResolvedValueOnce({
      id: 'u1', organisation_id: 'org-2', email: 'a@x.dev', full_name: 'A', phone: null,
      role: 'reception', status: 'active', is_agency_admin: false,
      last_active_at: null, permissions: {},
    });
    permissionsService.getMatrix.mockResolvedValueOnce({
      catalog: {},
      roles: { reception: { 'crm.view': true, 'finance.view': false } },
      pages: {},
      overrides: {},
    });
    const scope = { orgIds: ['org-1', 'org-2'], agencyWide: true, agencyOrgId: 'org-1' };
    const out = await teamService.get(scope, 'u1');
    expect(permissionsService.getMatrix).toHaveBeenCalledWith('org-2');
    expect(out.role_defaults).toEqual({
      reception: { 'crm.view': true, 'finance.view': false },
    });
  });

  it('a membership row for the home org does not produce a duplicate entry', async () => {
    authRepository.getUserInOrgs.mockResolvedValueOnce({
      id: 'u1', organisation_id: 'org-1', email: 'a@x.dev', full_name: 'A', phone: null,
      role: 'owner', status: 'active', is_agency_admin: false, last_active_at: null, permissions: {},
    });
    membershipRepository.listForUser.mockResolvedValueOnce([
      { organisation_id: 'org-1', name: 'Mine', role: 'owner', permissions: {} },
    ]);
    agencyRepository.orgNames.mockResolvedValueOnce(new Map([['org-1', 'Home']]));
    const out = await teamService.get(SCOPE, 'u1');
    expect(out.accounts).toEqual([{ id: 'org-1', name: 'Home', role: 'owner' }]);
  });
});
