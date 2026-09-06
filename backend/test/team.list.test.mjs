// The scope rule, in one file: a plain owner sees their own org; an agency
// admin at home sees the agency org plus its children; the SAME admin
// switched into a child sees only that child.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import './setup.js';

vi.mock('../src/repositories/agency.repository.js', () => ({
  agencyRepository: {
    childOrgs: vi.fn(async () => [
      { id: 'child-1', name: 'Rye Dental', created_at: '2026-01-01' },
      { id: 'child-2', name: 'Barnet', created_at: '2026-01-02' },
    ]),
    orgNames: vi.fn(async () => new Map([
      ['agency-1', 'Plan4growth'], ['child-1', 'Rye Dental'], ['child-2', 'Barnet'],
    ])),
  },
}));
vi.mock('../src/repositories/auth.repository.js', () => ({
  authRepository: { listMembersForOrgs: vi.fn(async () => []) },
}));
vi.mock('../src/repositories/membership.repository.js', () => ({
  membershipRepository: { listForUsers: vi.fn(async () => new Map()) },
}));

const { authRepository } = await import('../src/repositories/auth.repository.js');
const { membershipRepository } = await import('../src/repositories/membership.repository.js');
const { adminScope, teamService } = await import('../src/services/team.service.js');

beforeEach(() => vi.clearAllMocks());

describe('adminScope', () => {
  it('a plain owner administers their own org only', async () => {
    const scope = await adminScope({ user: { organisation_id: 'org-1', is_agency_admin: false } });
    expect(scope).toEqual({ orgIds: ['org-1'], agencyWide: false, agencyOrgId: null });
  });

  it('an agency admin at home administers the agency org and its children', async () => {
    const scope = await adminScope({
      user: { organisation_id: 'agency-1', is_agency_admin: true },
      agencyOrgId: 'agency-1',
    });
    expect(scope.agencyWide).toBe(true);
    expect(scope.orgIds).toEqual(['agency-1', 'child-1', 'child-2']);
  });

  it('an agency admin SWITCHED into a child administers that child alone', async () => {
    const scope = await adminScope({
      user: { organisation_id: 'child-1', is_agency_admin: true },
      agencyOrgId: 'agency-1',
      agencyContext: { actorUserId: 'u1', homeOrgId: 'agency-1' },
    });
    expect(scope).toEqual({ orgIds: ['child-1'], agencyWide: false, agencyOrgId: null });
  });

  it('an agency admin acting through a membership switch (x-active-org) administers only that org', async () => {
    const scope = await adminScope({
      user: { organisation_id: 'child-1', is_agency_admin: true },
      agencyOrgId: 'agency-1',
      activeOrgSwitched: true,
    });
    expect(scope).toEqual({ orgIds: ['child-1'], agencyWide: false, agencyOrgId: null });
  });
});

describe('teamService.list', () => {
  it('a plain owner gets no accounts column and no cross-org read', async () => {
    authRepository.listMembersForOrgs.mockResolvedValueOnce([
      { id: 'u1', organisation_id: 'org-1', email: 'a@x.dev', full_name: 'A', phone: null,
        role: 'owner', status: 'active', is_agency_admin: false, last_active_at: null },
    ]);
    const out = await teamService.list({ orgIds: ['org-1'], agencyWide: false, agencyOrgId: null });
    expect(out.agency_wide).toBe(false);
    expect(out.members[0].accounts).toBeUndefined();
    expect(membershipRepository.listForUsers).not.toHaveBeenCalled();
    expect(authRepository.listMembersForOrgs).toHaveBeenCalledWith(['org-1']);
  });

  it('an agency admin gets each member stamped with the accounts they reach', async () => {
    authRepository.listMembersForOrgs.mockResolvedValueOnce([
      { id: 'u1', organisation_id: 'agency-1', email: 'a@x.dev', full_name: 'A', phone: '+44 1',
        role: 'owner', status: 'active', is_agency_admin: true, last_active_at: null },
    ]);
    // Home org's membership row deliberately listed SECOND: the home org
    // must still come first in the result, from the users row, not from
    // whatever order user_organisations happens to return.
    membershipRepository.listForUsers.mockResolvedValueOnce(new Map([
      ['u1', [
        { user_id: 'u1', organisation_id: 'child-2', role: 'practice_manager' },
        { user_id: 'u1', organisation_id: 'agency-1', role: 'owner' },
      ]],
    ]));
    const out = await teamService.list({
      orgIds: ['agency-1', 'child-1', 'child-2'], agencyWide: true, agencyOrgId: 'agency-1',
    });
    expect(out.agency_wide).toBe(true);
    expect(out.members[0].accounts).toEqual([
      { id: 'agency-1', name: 'Plan4growth', role: 'owner' },
      { id: 'child-2', name: 'Barnet', role: 'practice_manager' },
    ]);
  });

  it('a member with no membership rows still reports their home org', async () => {
    // user_organisations is additive and provisionMember/invite never write a
    // row to it, so a user onboarded since the 000136 backfill has none —
    // membershipRepository.listForUsers resolves the default empty Map.
    authRepository.listMembersForOrgs.mockResolvedValueOnce([
      { id: 'u1', organisation_id: 'agency-1', email: 'a@x.dev', full_name: 'A', phone: null,
        role: 'owner', status: 'active', is_agency_admin: true, last_active_at: null },
    ]);
    const out = await teamService.list({
      orgIds: ['agency-1', 'child-1', 'child-2'], agencyWide: true, agencyOrgId: 'agency-1',
    });
    expect(out.members[0].accounts).toEqual([
      { id: 'agency-1', name: 'Plan4growth', role: 'owner' },
    ]);
  });

  it('a membership row for the home org is not duplicated', async () => {
    authRepository.listMembersForOrgs.mockResolvedValueOnce([
      { id: 'u1', organisation_id: 'agency-1', email: 'a@x.dev', full_name: 'A', phone: null,
        role: 'owner', status: 'active', is_agency_admin: true, last_active_at: null },
    ]);
    membershipRepository.listForUsers.mockResolvedValueOnce(new Map([
      ['u1', [{ user_id: 'u1', organisation_id: 'agency-1', role: 'owner' }]],
    ]));
    const out = await teamService.list({
      orgIds: ['agency-1', 'child-1', 'child-2'], agencyWide: true, agencyOrgId: 'agency-1',
    });
    expect(out.members[0].accounts).toEqual([
      { id: 'agency-1', name: 'Plan4growth', role: 'owner' },
    ]);
  });

  it('memberships are read scoped to the administered orgs, never all of them', async () => {
    authRepository.listMembersForOrgs.mockResolvedValueOnce([
      { id: 'u1', organisation_id: 'agency-1', email: 'a@x.dev', full_name: 'A', phone: null,
        role: 'owner', status: 'active', is_agency_admin: true, last_active_at: null },
    ]);
    await teamService.list({ orgIds: ['agency-1', 'child-1'], agencyWide: true, agencyOrgId: 'agency-1' });
    expect(membershipRepository.listForUsers).toHaveBeenCalledWith(['u1'], ['agency-1', 'child-1']);
  });
});
