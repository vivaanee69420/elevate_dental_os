// Agency-actor gates. Access is a PER-USER grant (users.is_agency_admin), not
// "owner of an org flagged is_agency" — an agency org holds our staff AND
// client users, so the org flag alone handed sub-account creation, practice
// mapping and production logs to real clients.
import { describe, it, expect, vi } from 'vitest';

const { isAgencyActor, requireAgencyActor, requireAgencyOwner, agencyHomeOrgId } =
  await import('../src/middleware/agency.js');

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

const AGENCY_ORG = 'agency-1';

describe('agency middleware', () => {
  it('a user holding the grant is an actor', async () => {
    const req = { user: { role: 'owner', organisation_id: 'org-x', is_agency_admin: true } };
    expect(await isAgencyActor(req)).toBe(true);
  });

  it('an OWNER without the grant is NOT an actor, even in the agency org', async () => {
    // The regression this replaced: Plan4growth's client owners.
    const req = { user: { role: 'owner', organisation_id: AGENCY_ORG, is_agency_admin: false } };
    expect(await isAgencyActor(req)).toBe(false);
  });

  it('a sub-account owner is NOT an actor', async () => {
    expect(await isAgencyActor({ user: { role: 'owner', organisation_id: 'sub-1' } })).toBe(false);
  });

  it('a switched context is an actor (already validated in authenticate)', async () => {
    const req = {
      user: { role: 'owner', organisation_id: 'sub-1' },
      agencyContext: { actorUserId: 'u1', homeOrgId: AGENCY_ORG },
    };
    expect(await isAgencyActor(req)).toBe(true);
  });

  it('requireAgencyActor 403s AGENCY_ONLY without the grant and passes with it', async () => {
    const res = mockRes(); const next = vi.fn();
    await requireAgencyActor({ user: { role: 'owner', organisation_id: AGENCY_ORG } }, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Agency access required', code: 'AGENCY_ONLY' });
    expect(next).not.toHaveBeenCalled();

    const res2 = mockRes(); const next2 = vi.fn();
    await requireAgencyOwner({ user: { role: 'owner', organisation_id: 'org-x', is_agency_admin: true } }, res2, next2);
    expect(next2).toHaveBeenCalledOnce();
  });
});

describe('agencyHomeOrgId', () => {
  it('uses the resolved agency org, not the admin\'s own org', () => {
    // An agency admin may sit in a DIFFERENT org and still administer the
    // agency's sub-accounts.
    const req = { user: { organisation_id: 'developer-org' }, agencyOrgId: AGENCY_ORG };
    expect(agencyHomeOrgId(req)).toBe(AGENCY_ORG);
  });

  it('prefers the switched context home org', () => {
    const req = {
      user: { organisation_id: 'sub-1' },
      agencyOrgId: AGENCY_ORG,
      agencyContext: { actorUserId: 'u1', homeOrgId: AGENCY_ORG },
    };
    expect(agencyHomeOrgId(req)).toBe(AGENCY_ORG);
  });

  it('falls back to the caller org when no agency context exists', () => {
    expect(agencyHomeOrgId({ user: { organisation_id: 'org-y' } })).toBe('org-y');
  });
});
