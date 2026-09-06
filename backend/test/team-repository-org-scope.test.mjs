// The tenant boundary itself.
//
// Every OTHER test around Settings → Team mocks authRepository and
// membershipRepository wholesale, so the org predicates these three reads and
// writes carry — the only thing standing between an agency-wide team screen
// and a cross-org read or write — could be deleted and the suite would stay
// green. These tests assert the FILTER CHAIN recorded by the Supabase stub,
// not a value the stub was told to return, so removing a filter fails them.
//
// Same idiom as auth-repository-list-members-for-orgs.test.mjs: read
// supaRec.last after the call.
import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';
import { authRepository } from '../src/repositories/auth.repository.js';
import { membershipRepository } from '../src/repositories/membership.repository.js';

const ORGS = ['org-1', 'org-2'];

beforeEach(() => {
  supaRec.resultProvider = () => ({ data: [], error: null });
});

describe('authRepository.getUserInOrgs', () => {
  it('restricts the read to the administered orgs AND the requested id', async () => {
    await authRepository.getUserInOrgs(ORGS, 'u-1');
    expect(supaRec.last.table).toBe('users');
    expect(supaRec.last.op).toBe('select');
    // The org predicate. Without it, any user id in the estate resolves.
    expect(supaRec.last.ins).toEqual([{ col: 'organisation_id', vals: ORGS }]);
    expect(supaRec.last.eqs).toEqual([{ col: 'id', val: 'u-1' }]);
  });

  it('never issues a query at all for an empty scope', async () => {
    // An empty org list must not degrade into an unfiltered read: PostgREST
    // treats .in('organisation_id', []) as matching nothing today, but the
    // repository must not depend on that.
    supaRec.last = undefined;
    const out = await authRepository.getUserInOrgs([], 'u-1');
    expect(out).toBeNull();
    expect(supaRec.last).toBeUndefined();
  });
});

describe('authRepository.updateMember', () => {
  it('pins the org on the write, not just the user id', async () => {
    await authRepository.updateMember('org-1', 'u-1', { role: 'reception' });
    expect(supaRec.last.table).toBe('users');
    expect(supaRec.last.op).toBe('update');
    expect(supaRec.last.updateVals).toEqual({ role: 'reception' });
    // Both predicates, in either order — an update by id alone would let a
    // stale/spoofed id rewrite a row in another tenant.
    expect(supaRec.last.eqs).toEqual(
      expect.arrayContaining([
        { col: 'organisation_id', val: 'org-1' },
        { col: 'id', val: 'u-1' },
      ]),
    );
    expect(supaRec.last.eqs).toHaveLength(2);
  });
});

describe('membershipRepository.listForUsers', () => {
  it('filters by BOTH the user list and the administered orgs', async () => {
    await membershipRepository.listForUsers(['u-1', 'u-2'], ORGS);
    expect(supaRec.last.table).toBe('user_organisations');
    expect(supaRec.last.op).toBe('select');
    expect(supaRec.last.ins).toEqual(
      expect.arrayContaining([
        { col: 'user_id', vals: ['u-1', 'u-2'] },
        { col: 'organisation_id', vals: ORGS },
      ]),
    );
    expect(supaRec.last.ins).toHaveLength(2);
  });

  it('never issues a query at all for an empty org scope', async () => {
    supaRec.last = undefined;
    const out = await membershipRepository.listForUsers(['u-1'], []);
    expect(out.size).toBe(0);
    expect(supaRec.last).toBeUndefined();
  });
});
