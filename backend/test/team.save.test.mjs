import { describe, it, expect, vi, beforeEach } from 'vitest';
import './setup.js';

vi.mock('../src/repositories/auth.repository.js', () => ({
  authRepository: { getUserInOrgs: vi.fn(), updateMember: vi.fn(async () => {}) },
}));
vi.mock('../src/repositories/membership.repository.js', () => ({
  membershipRepository: { listForUser: vi.fn(async () => []), add: vi.fn(), remove: vi.fn() },
}));
vi.mock('../src/repositories/agency.repository.js', () => ({
  agencyRepository: { childOrgs: vi.fn(async () => []), orgNames: vi.fn(async () => new Map()) },
}));
vi.mock('../src/services/permissions.service.js', () => ({
  permissionsService: { getEffectiveForUser: vi.fn(async () => ({})) },
}));

const { authRepository } = await import('../src/repositories/auth.repository.js');
const { teamService, mergeOverrides } = await import('../src/services/team.service.js');

const SCOPE = { orgIds: ['org-1'], agencyWide: false, agencyOrgId: null };
const OWNER = { id: 'caller', role: 'owner', permissions: {} };
const TARGET = {
  id: 'u1', organisation_id: 'org-1', email: 'a@x.dev', full_name: 'A', phone: null,
  role: 'reception', status: 'active', is_agency_admin: false, last_active_at: null,
  permissions: { 'crm.view': true, 'finance.view': false },
};

beforeEach(() => {
  vi.clearAllMocks();
  authRepository.getUserInOrgs.mockResolvedValue({ ...TARGET });
});

describe('mergeOverrides', () => {
  it('null removes a key so the row goes back to inheriting the role', () => {
    expect(mergeOverrides({ a: true, b: false }, { a: null })).toEqual({ b: false });
  });
  it('false is an explicit deny, not a removal', () => {
    expect(mergeOverrides({}, { a: false })).toEqual({ a: false });
  });
  it('leaves keys the patch does not mention alone', () => {
    expect(mergeOverrides({ a: true }, { b: true })).toEqual({ a: true, b: true });
  });
  it('false narrows an existing grant to an explicit deny, not a removal', () => {
    expect(mergeOverrides({ a: true }, { a: false })).toEqual({ a: false });
  });
});

describe('teamService.save', () => {
  it('404s a user outside the administered orgs', async () => {
    authRepository.getUserInOrgs.mockResolvedValueOnce(null);
    await expect(teamService.save(SCOPE, OWNER, 'u-other', { full_name: 'X' }))
      .rejects.toThrow(/not found/i);
    expect(authRepository.updateMember).not.toHaveBeenCalled();
  });

  it('refuses a caller who cannot manage the target role', async () => {
    authRepository.getUserInOrgs.mockResolvedValueOnce({ ...TARGET, role: 'owner' });
    const pm = { id: 'c', role: 'practice_manager', permissions: {} };
    await expect(teamService.save(SCOPE, pm, 'u1', { full_name: 'X' })).rejects.toThrow(/role/i);
    expect(authRepository.updateMember).not.toHaveBeenCalled();
  });

  it('refuses promoting a target above the caller', async () => {
    const pm = { id: 'c', role: 'practice_manager', permissions: { 'crm.view': true } };
    await expect(teamService.save(SCOPE, pm, 'u1', { role: 'owner' })).rejects.toThrow(/role/i);
    expect(authRepository.updateMember).not.toHaveBeenCalled();
  });

  it('enforces the grant ceiling — you cannot give what you do not hold', async () => {
    const pm = { id: 'c', role: 'practice_manager', permissions: { 'crm.view': true } };
    await expect(teamService.save(SCOPE, pm, 'u1', { permissions: { 'finance.view': true } }))
      .rejects.toThrow(/cannot grant/i);
    expect(authRepository.updateMember).not.toHaveBeenCalled();
  });

  it('rejects a permission key that is not in the catalogue', async () => {
    await expect(teamService.save(SCOPE, OWNER, 'u1', { permissions: { 'not.a.key': true } }))
      .rejects.toThrow(/unknown permission/i);
    expect(authRepository.updateMember).not.toHaveBeenCalled();
  });

  it('writes the merged overrides against the target OWN org', async () => {
    const out = await teamService.save(SCOPE, OWNER, 'u1', {
      full_name: 'Jane Smith', phone: '+44 7700 900001', role: 'practice_manager',
      permissions: { 'finance.view': null, 'growth.view': true },
    });
    expect(authRepository.updateMember).toHaveBeenCalledWith('org-1', 'u1', {
      full_name: 'Jane Smith',
      phone: '+44 7700 900001',
      role: 'practice_manager',
      permissions: { 'crm.view': true, 'growth.view': true },
    });
    expect(out.permissions).toEqual({ 'crm.view': true, 'growth.view': true });
  });

  it('rejects organisation_ids from a caller who is not an agency admin', async () => {
    await expect(teamService.save(SCOPE, OWNER, 'u1', { organisation_ids: ['org-1'] }))
      .rejects.toThrow(/agency/i);
    expect(authRepository.updateMember).not.toHaveBeenCalled();
  });

  it('a profile-only save does not rewrite permissions', async () => {
    await teamService.save(SCOPE, OWNER, 'u1', { full_name: 'Just The Name' });
    expect(authRepository.updateMember).toHaveBeenCalledWith('org-1', 'u1', {
      full_name: 'Just The Name',
    });
  });

  it('refuses a caller changing their own role', async () => {
    authRepository.getUserInOrgs.mockResolvedValueOnce({ ...TARGET, id: 'caller', role: 'owner' });
    await expect(teamService.save(SCOPE, OWNER, 'caller', { role: 'reception' }))
      .rejects.toThrow(/own role/i);
    expect(authRepository.updateMember).not.toHaveBeenCalled();
  });

  it('allows a caller saving their own profile with their role unchanged', async () => {
    authRepository.getUserInOrgs.mockResolvedValueOnce({ ...TARGET, id: 'caller', role: 'owner' });
    const out = await teamService.save(SCOPE, OWNER, 'caller', { full_name: 'New Name', role: 'owner' });
    expect(authRepository.updateMember).toHaveBeenCalledWith('org-1', 'caller', {
      full_name: 'New Name',
      role: 'owner',
    });
    expect(out.success).toBe(true);
  });

  it('allows a caller changing someone else’s role', async () => {
    await teamService.save(SCOPE, OWNER, 'u1', { role: 'practice_manager' });
    expect(authRepository.updateMember).toHaveBeenCalledWith('org-1', 'u1', {
      role: 'practice_manager',
    });
  });
});
