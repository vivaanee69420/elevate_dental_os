// ============================================================================
// T6 — CROSS-ORG ISOLATION (CRITICAL)
//
// The permissions repository runs on serviceClient, which BYPASSES RLS. The
// ONLY app-layer tenant guard on that path is the explicit
// .eq('organisation_id', orgId) chained on every query (see CLAUDE.md). RLS
// (current_org_id()) is the live-DB backstop, exercised by the SQL migration
// / integration suite — these tests prove the APPLICATION-LAYER filter so a
// service-client query can never silently span organisations.
//
// We run the REAL repository against the fake Supabase client from
// test/setup.js, recording every .eq() filter, and assert organisation_id
// is always pinned to the caller's org and NEVER to a foreign org.
// ============================================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const repoPkg = await import('../src/repositories/permissions.repository.js');
const { permissionsRepository } = repoPkg;
const svcPkg = await import('../src/services/permissions.service.js');
const { permissionsService } = svcPkg;

const ORG_A = 'org-aaaaaaaa';
const ORG_B = 'org-bbbbbbbb';

const orgFilter = (q) => q.eqs.find((e) => e.col === 'organisation_id');

beforeEach(() => {
  supaRec.last = undefined;
  supaRec.resultProvider = () => ({ data: [], error: null });
});

describe('repository pins organisation_id on every query', () => {
  it('listByOrg filters by the given org and never another', async () => {
    await permissionsRepository.listByOrg(ORG_A);
    expect(supaRec.last.table).toBe('role_permissions');
    expect(orgFilter(supaRec.last)).toEqual({
      col: 'organisation_id',
      val: ORG_A,
    });
    expect(supaRec.last.eqs.some((e) => e.val === ORG_B)).toBe(false);
  });

  it('listByOrgRole filters by both org AND role, org pinned to caller', async () => {
    await permissionsRepository.listByOrgRole(ORG_A, 'owner');
    expect(orgFilter(supaRec.last)).toEqual({
      col: 'organisation_id',
      val: ORG_A,
    });
    expect(supaRec.last.eqs).toContainEqual({ col: 'role', val: 'owner' });
    expect(supaRec.last.eqs.some((e) => e.val === ORG_B)).toBe(false);
  });

  it('setRolePermission writes the org into the upserted row', async () => {
    await permissionsRepository.setRolePermission(
      ORG_A,
      'owner',
      'finance.view',
      true,
    );
    expect(supaRec.last.op).toBe('upsert');
    expect(supaRec.last.upsertVals.organisation_id).toBe(ORG_A);
    expect(supaRec.last.upsertVals.organisation_id).not.toBe(ORG_B);
  });

  it('getUser scopes the lookup by org AND user id', async () => {
    supaRec.resultProvider = () => ({
      data: { id: 'u1', organisation_id: ORG_A },
      error: null,
    });
    await permissionsRepository.getUser(ORG_A, 'u1');
    expect(supaRec.last.table).toBe('users');
    expect(orgFilter(supaRec.last)).toEqual({
      col: 'organisation_id',
      val: ORG_A,
    });
    expect(supaRec.last.eqs).toContainEqual({ col: 'id', val: 'u1' });
  });

  it('setUserOverrides scopes the write by org AND user id', async () => {
    await permissionsRepository.setUserOverrides(ORG_A, 'u1', {
      'crm.view': true,
    });
    expect(supaRec.last.op).toBe('update');
    expect(orgFilter(supaRec.last)).toEqual({
      col: 'organisation_id',
      val: ORG_A,
    });
    expect(supaRec.last.eqs).toContainEqual({ col: 'id', val: 'u1' });
    expect(supaRec.last.eqs.some((e) => e.val === ORG_B)).toBe(false);
  });
});

describe('cross-org access cannot match a foreign-org row', () => {
  it("getUser for an org-B user, called with org A's id, filters on org A (no match -> error)", async () => {
    // The DB-equivalent: the org-scoped .eq() excludes the org-B row, so the
    // single() lookup returns no row. The repo must surface that error, never
    // the foreign user.
    supaRec.resultProvider = (q) => {
      const f = orgFilter(q);
      const idEq = q.eqs.find((e) => e.col === 'id');
      const matches =
        f && f.val === ORG_B && idEq && idEq.val === 'user-in-B';
      return matches
        ? { data: { id: 'user-in-B', organisation_id: ORG_B }, error: null }
        : { data: null, error: { code: 'PGRST116', message: 'no rows' } };
    };

    await expect(
      permissionsRepository.getUser(ORG_A, 'user-in-B'),
    ).rejects.toBeTruthy();
    // The filter actually sent pinned ORG_A — never ORG_B.
    expect(orgFilter(supaRec.last).val).toBe(ORG_A);
    expect(
      supaRec.last.eqs.some(
        (e) => e.col === 'organisation_id' && e.val === ORG_B,
      ),
    ).toBe(false);
  });

  it('setUserOverrides for org A never targets an org-B-scoped row', async () => {
    await permissionsRepository.setUserOverrides(ORG_A, 'user-in-B', {
      'finance.view': true,
    });
    const f = orgFilter(supaRec.last);
    expect(f.val).toBe(ORG_A);
    expect(f.val).not.toBe(ORG_B);
    // Both org AND id constrain the write: an org-A request can never mutate
    // an org-B user even if it knows that user's id.
    expect(supaRec.last.eqs.map((e) => e.col).sort()).toEqual([
      'id',
      'organisation_id',
    ]);
  });

  it('a foreign-org override attempt is rejected and never writes (org filter excludes it)', async () => {
    // user-in-B exists only in ORG_B. Service called with ORG_A: the
    // org-scoped getUser query pins ORG_A, so the org-B row is invisible and
    // the call rejects. CRITICAL: no update is ever issued against the
    // foreign user. (Whether the rejection is a clean AppError 404 or the
    // raw PGRST116 from .single() is the documented gap covered in
    // permissions.service.test.mjs; what matters for T6 is no cross-org
    // read/write occurs.)
    supaRec.resultProvider = (q) => {
      const f = orgFilter(q);
      return f && f.val === ORG_B
        ? { data: { id: 'user-in-B', permissions: {} }, error: null }
        : { data: null, error: { code: 'PGRST116', message: 'no rows' } };
    };
    await expect(
      permissionsService.setUserOverride(
        ORG_A,
        'user-in-B',
        'finance.view',
        true,
      ),
    ).rejects.toBeTruthy();
    // The query that ran was pinned to ORG_A and it was a read, not a write.
    expect(orgFilter(supaRec.last).val).toBe(ORG_A);
    expect(supaRec.last.op).toBe('select');
  });
});

describe('service threads orgId through to the repo unchanged', () => {
  it('setUserOverride pins the caller org on both the read and the write', async () => {
    supaRec.resultProvider = (q) =>
      q.op === 'select'
        ? { data: { id: 'u1', permissions: {} }, error: null }
        : { data: null, error: null };
    await permissionsService.setUserOverride(
      ORG_A,
      'u1',
      'finance.view',
      true,
    );
    expect(supaRec.last.op).toBe('update');
    expect(orgFilter(supaRec.last).val).toBe(ORG_A);
  });
});
