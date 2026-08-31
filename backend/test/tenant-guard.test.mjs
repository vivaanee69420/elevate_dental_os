// Cross-tenant write/read guards (isolation audit, phase A4).
//
// Two distinct holes this closes:
//  1. MASS ASSIGNMENT — a freeform PATCH body could set `organisation_id` and
//     move a row into another tenant (the WHERE was org-scoped, the SET was not).
//  2. FOREIGN FK — a body-supplied contact_id/practice_id/assigned_to belonging
//     to another org was written unchecked; PostgREST embeds then resolve that
//     FK under serviceClient with NO org predicate, turning a stored foreign id
//     into a cross-org PII read.
import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const { stripImmutable, assertOrgOwns } = await import('../src/lib/tenant-guard.js');

const ORG = 'org-a';

describe('stripImmutable', () => {
  it('drops organisation_id so a patch can never re-home a row', () => {
    expect(stripImmutable({ first_name: 'Ann', organisation_id: 'org-b' }))
      .toEqual({ first_name: 'Ann' });
  });

  it('drops id and created_at too (identity is never patchable)', () => {
    const out = stripImmutable({ id: 'x', created_at: 't', notes: 'keep' });
    expect(out).toEqual({ notes: 'keep' });
  });

  it('leaves an ordinary patch untouched and does not mutate the input', () => {
    const input = { status: 'completed', notes: 'ok' };
    expect(stripImmutable(input)).toEqual({ status: 'completed', notes: 'ok' });
    expect(input).toEqual({ status: 'completed', notes: 'ok' });
  });

  it('tolerates null/undefined', () => {
    expect(stripImmutable(undefined)).toEqual({});
    expect(stripImmutable(null)).toEqual({});
  });
});

describe('assertOrgOwns', () => {
  beforeEach(() => { supaRec.resultProvider = () => ({ data: null, error: null }); });

  it('passes silently for a null/undefined id (optional FK)', async () => {
    supaRec.last = undefined;
    await assertOrgOwns(ORG, 'contacts', null, 'Contact');
    await assertOrgOwns(ORG, 'contacts', undefined, 'Contact');
    expect(supaRec.last).toBeUndefined(); // no query at all
  });

  it('queries the table scoped to BOTH the id and the caller org', async () => {
    supaRec.resultProvider = () => ({ data: { id: 'c1' }, error: null });
    await assertOrgOwns(ORG, 'contacts', 'c1', 'Contact');
    expect(supaRec.last.table).toBe('contacts');
    expect(supaRec.last.eqs).toEqual(expect.arrayContaining([
      { col: 'id', val: 'c1' },
      { col: 'organisation_id', val: ORG },
    ]));
  });

  it('rejects a foreign-org id with 404 (no existence oracle)', async () => {
    supaRec.resultProvider = () => ({ data: null, error: null });
    await expect(assertOrgOwns(ORG, 'contacts', 'org-b-contact', 'Contact'))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  it('fails closed on a lookup error rather than allowing the write', async () => {
    supaRec.resultProvider = () => ({ data: null, error: { message: 'boom' } });
    await expect(assertOrgOwns(ORG, 'contacts', 'c1', 'Contact')).rejects.toBeTruthy();
  });
});
