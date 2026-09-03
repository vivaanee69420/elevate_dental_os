// ============================================================================
// Appointments patient search (migration 000147).
//
// The repository runs on serviceClient, which BYPASSES RLS, so the ONLY tenant
// guard is the org id the caller passes down (CLAUDE.md rule 3). For the search
// path that id is an RPC argument rather than an .eq() filter, so these tests
// pin it there — and pin that the term itself can never carry an org.
// ============================================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { supaRec } from './setup.js';
import { appointmentRepository } from '../src/repositories/appointment.repository.js';
import { appointmentListQuerySchema } from '../src/models/appointment.model.js';

const ORG_A = 'org-aaaaaaaa';
const ORG_B = 'org-bbbbbbbb';

// The PMS gate reads the integrations table before anything else; leave it
// open for these tests (a revoked PMS is covered by its own case below).
vi.mock('../src/lib/integration-gating.js', () => ({
  pmsHidden: vi.fn(async () => false),
}));
const { pmsHidden } = await import('../src/lib/integration-gating.js');

const rpcCall = () => (supaRec.rpcCalls ?? []).at(-1);

// One row in the shape appointments_search returns: the appointment JSON plus
// the match total riding along on every row.
const row = (id, total) => ({
  appointment: {
    id,
    starts_at: '2026-09-01T09:00:00Z',
    contact: { id: 'c1', first_name: 'Jane', last_name: 'Smith', email: 'j@x.com', phone: '07700900123' },
    associate: { id: 'a1', full_name: 'Dr Who' },
    practice: { id: 'p1', name: 'Ashford' },
  },
  total,
});

beforeEach(() => {
  supaRec.last = undefined;
  supaRec.rpcCalls = [];
  supaRec.rpcProvider = undefined;
  supaRec.resultProvider = () => ({ data: [], error: null });
  pmsHidden.mockResolvedValue(false);
});

describe('routing: a search term takes the RPC path, nothing else does', () => {
  it('sends the term to appointments_search instead of querying the table', async () => {
    supaRec.rpcProvider = () => ({ data: [row('ap1', 3)], error: null });
    await appointmentRepository.list(ORG_A, { search: 'smith', page: 1, per_page: 25 });

    expect(rpcCall().fn).toBe('appointments_search');
    expect(rpcCall().params.p_term).toBe('smith');
    // No PostgREST query was built at all — the whole point of the branch.
    expect(supaRec.last).toBeUndefined();
  });

  it('without a term the existing table query is used, untouched', async () => {
    await appointmentRepository.list(ORG_A, { page: 1, per_page: 25 });

    expect(supaRec.rpcCalls).toHaveLength(0);
    expect(supaRec.last.table).toBe('appointments');
    expect(supaRec.last.eqs).toContainEqual({ col: 'organisation_id', val: ORG_A });
  });

  it('a revoked PMS hides the search too, before the RPC is ever called', async () => {
    pmsHidden.mockResolvedValue(true);
    const out = await appointmentRepository.list(ORG_A, { search: 'smith', page: 1, per_page: 25 });

    expect(out).toEqual({ rows: [], total: 0 });
    expect(supaRec.rpcCalls).toHaveLength(0);
  });
});

describe('cross-org isolation', () => {
  it('binds the caller org server-side and never another org', async () => {
    supaRec.rpcProvider = () => ({ data: [row('ap1', 1)], error: null });
    await appointmentRepository.list(ORG_A, { search: 'smith', page: 1, per_page: 25 });

    expect(rpcCall().params.p_org).toBe(ORG_A);
    expect(JSON.stringify(rpcCall().params)).not.toContain(ORG_B);
  });

  it('the org is not something the query string can influence', async () => {
    supaRec.rpcProvider = () => ({ data: [], error: null });
    // A caller stuffing an org id into every parseable field must not move it.
    const q = appointmentListQuerySchema.parse({
      search: ORG_B,
      practice_id: '11111111-1111-4111-8111-111111111111',
      page: '1',
      per_page: '25',
    });
    await appointmentRepository.list(ORG_A, q);

    expect(rpcCall().params.p_org).toBe(ORG_A);
  });
});

describe('filters carried into the RPC', () => {
  it('passes practice, associate and patients_only through', async () => {
    supaRec.rpcProvider = () => ({ data: [], error: null });
    await appointmentRepository.list(ORG_A, {
      search: 'smith',
      practice_id: 'p1',
      associate_id: 'a1',
      patients_only: 'false',
      page: 2,
      per_page: 10,
    });

    expect(rpcCall().params).toMatchObject({
      p_practice: 'p1',
      p_associate: 'a1',
      p_patients_only: false,
      p_limit: 10,
      p_offset: 10, // page 2 of 10
    });
  });

  it('sends nulls, not undefined, when practice and associate are unset', async () => {
    supaRec.rpcProvider = () => ({ data: [], error: null });
    await appointmentRepository.list(ORG_A, { search: 'smith', page: 1, per_page: 25 });

    expect(rpcCall().params.p_practice).toBeNull();
    expect(rpcCall().params.p_associate).toBeNull();
  });

  it('does NOT pass from/to — a search deliberately spans all dates', async () => {
    supaRec.rpcProvider = () => ({ data: [], error: null });
    await appointmentRepository.list(ORG_A, {
      search: 'smith',
      from: '2026-01-01T00:00:00Z',
      to: '2026-02-01T00:00:00Z',
      page: 1,
      per_page: 25,
    });

    const sent = JSON.stringify(rpcCall().params);
    expect(sent).not.toContain('2026-01-01');
    expect(sent).not.toContain('2026-02-01');
  });
});

describe('result shaping', () => {
  it('unwraps the appointment and lifts the total off the first row', async () => {
    supaRec.rpcProvider = () => ({ data: [row('ap1', 42), row('ap2', 42)], error: null });
    const out = await appointmentRepository.list(ORG_A, { search: 'smith', page: 1, per_page: 25 });

    expect(out.total).toBe(42);
    expect(out.rows.map((r) => r.id)).toEqual(['ap1', 'ap2']);
    // The nested embed shape the unsearched list returns, including the
    // email/phone the Contact column needs.
    expect(out.rows[0].contact).toMatchObject({ email: 'j@x.com', phone: '07700900123' });
    expect(out.rows[0].practice).toMatchObject({ name: 'Ashford' });
  });

  it('a bigint total arriving as a string is still a number', async () => {
    supaRec.rpcProvider = () => ({ data: [{ ...row('ap1'), total: '1130' }], error: null });
    const out = await appointmentRepository.list(ORG_A, { search: 'smith', page: 1, per_page: 25 });

    expect(out.total).toBe(1130);
  });

  it('no matches reads as an empty result, not a crash', async () => {
    supaRec.rpcProvider = () => ({ data: [], error: null });
    const out = await appointmentRepository.list(ORG_A, { search: 'zzzz', page: 1, per_page: 25 });

    expect(out).toEqual({ rows: [], total: 0 });
  });

  it('an RPC error surfaces rather than reading as "no appointments"', async () => {
    supaRec.rpcProvider = () => ({ data: null, error: { message: 'boom' } });
    await expect(
      appointmentRepository.list(ORG_A, { search: 'smith', page: 1, per_page: 25 }),
    ).rejects.toThrow('boom');
  });

  it('the unsearched path selects contact email and phone too, so both shapes match', async () => {
    await appointmentRepository.list(ORG_A, { page: 1, per_page: 25 });

    expect(supaRec.last.select).toContain('contact:contacts(id, first_name, last_name, email, phone)');
  });
});

describe('the search term itself', () => {
  // Three is the trigram width: a shorter term cannot use the GIN index and
  // degrades to a full scan of the org's contacts, so the floor is a
  // performance boundary and not a preference.
  it('accepts three characters and rejects two', () => {
    expect(appointmentListQuerySchema.parse({ search: 'lil' }).search).toBe('lil');
    expect(() => appointmentListQuerySchema.parse({ search: 'li' })).toThrow();
  });

  it('treats a cleared box as no search rather than a 400', () => {
    expect(appointmentListQuerySchema.parse({ search: '' }).search).toBeUndefined();
    expect(appointmentListQuerySchema.parse({ search: '   ' }).search).toBeUndefined();
  });

  it('trims, so a trailing space does not become part of the match', () => {
    expect(appointmentListQuerySchema.parse({ search: '  smith  ' }).search).toBe('smith');
  });

  it('caps the length, so a pathological term cannot be sent at all', () => {
    expect(() => appointmentListQuerySchema.parse({ search: 'x'.repeat(81) })).toThrow();
  });

  it('passes a phone number through verbatim — normalisation is the RPC’s job', async () => {
    supaRec.rpcProvider = () => ({ data: [], error: null });
    await appointmentRepository.list(ORG_A, { search: '+44 7700 900123', page: 1, per_page: 25 });

    expect(rpcCall().params.p_term).toBe('+44 7700 900123');
  });

  it('passes wildcards through verbatim — escaping is the RPC’s job', async () => {
    supaRec.rpcProvider = () => ({ data: [], error: null });
    await appointmentRepository.list(ORG_A, { search: '100%', page: 1, per_page: 25 });

    expect(rpcCall().params.p_term).toBe('100%');
  });
});
