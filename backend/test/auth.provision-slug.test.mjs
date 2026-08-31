// organisations.slug is UNIQUE and derived from the organisation NAME, so a
// second practice with the same (or similarly punctuated) name would collide
// and fail the whole provision — a real hazard once an agency onboards many
// sub-accounts. Collisions retry with a short suffix; the first use of a name
// keeps the clean slug.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { supaRec } from './setup.js';

const { provisionOrgOwner } = await import('../src/services/auth.service.js');

function adminOK(m) {
  if (m === 'listUsers') return { data: { users: [] }, error: null };
  if (m === 'createUser') return { data: { user: { id: 'u1' } }, error: null };
  return { data: {}, error: null };
}

const BODY = {
  organisation_name: 'Smile Dental Care',
  email: 'o@smile.dev',
  full_name: 'Own Er',
  password: 'temp-password-123',
};

// Records every organisations insert; returns a unique-violation for any slug
// already in `taken`, mimicking the real constraint.
function orgInsertHarness(taken) {
  const attempted = [];
  supaRec.resultProvider = (q) => {
    // createOrganisation chains .insert(v).select().single(), which leaves
    // q.op as 'select' — key off insertVals instead.
    if (q.table === 'organisations' && q.insertVals) {
      const slug = q.insertVals?.slug;
      attempted.push(slug);
      if (taken.has(slug)) {
        return {
          data: null,
          error: {
            code: '23505',
            message: 'duplicate key value violates unique constraint "organisations_slug_key"',
          },
        };
      }
      return { data: { id: 'org-new', slug }, error: null };
    }
    return { data: [], error: null };
  };
  return attempted;
}

beforeEach(() => {
  supaRec.last = undefined;
  supaRec.adminCalls = [];
  supaRec.adminProvider = (m) => adminOK(m);
  supaRec.resultProvider = () => ({ data: [], error: null });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200 })));
});

describe('provisionOrgOwner slug collisions', () => {
  it('uses the clean name-derived slug when it is free', async () => {
    const attempted = orgInsertHarness(new Set());
    const out = await provisionOrgOwner(BODY, 'active');
    expect(attempted).toEqual(['smile-dental-care']);
    expect(out.organisation_id).toBe('org-new');
  });

  it('retries with a suffixed slug when the clean one is taken', async () => {
    const attempted = orgInsertHarness(new Set(['smile-dental-care']));
    const out = await provisionOrgOwner(BODY, 'active');
    expect(attempted.length).toBeGreaterThan(1);
    expect(attempted[0]).toBe('smile-dental-care');
    expect(attempted[1]).toMatch(/^smile-dental-care-[a-z0-9]{4,}$/);
    expect(out.organisation_id).toBe('org-new');
    // The auth identity must survive the retry — a rollback here would delete
    // the user we are about to attach to the org.
    expect((supaRec.adminCalls || []).some((c) => c.m === 'deleteUser')).toBe(false);
  });

  it('still rolls back the auth identity on a non-collision org error', async () => {
    supaRec.resultProvider = (q) =>
      q.table === 'organisations' && q.insertVals
        ? { data: null, error: { code: '42501', message: 'permission denied' } }
        : { data: [], error: null };
    await expect(provisionOrgOwner(BODY, 'active')).rejects.toMatchObject({ statusCode: 400 });
    expect((supaRec.adminCalls || []).some((c) => c.m === 'deleteUser')).toBe(true);
  });
});
