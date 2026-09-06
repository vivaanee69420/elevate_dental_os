// listMembersForOrgs pages by .range(), so its .order() must give a STABLE
// sort: created_at alone repeats/loses rows across page boundaries once two
// rows share a timestamp, and id alone (order() call is a rewrite of the
// paging cursor, not a sort a human reads) turned a plain owner's team list
// into arbitrary UUID order. created_at first (restores the join order people
// already see), id second (the tiebreaker that keeps .range() safe).
import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';
import { authRepository } from '../src/repositories/auth.repository.js';

const ORG = 'org-1';

beforeEach(() => {
  supaRec.resultProvider = () => ({ data: [], error: null });
});

describe('authRepository.listMembersForOrgs', () => {
  it('orders by created_at ascending then id ascending', async () => {
    await authRepository.listMembersForOrgs([ORG]);
    expect(supaRec.last.orders).toEqual([
      { col: 'created_at', opts: { ascending: true } },
      { col: 'id', opts: { ascending: true } },
    ]);
  });
});
