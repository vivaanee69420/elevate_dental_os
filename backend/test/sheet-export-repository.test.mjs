// Sheet export queue repository — tenant isolation (rule 3: explicit
// organisation_id on EVERY query / p_org on every RPC), RPC param
// pass-through, and the markRetry attempts/backoff branch. Mirrors
// test/sheet.repository.test.mjs conventions against test/setup.js's
// supabase-mock harness.
import './setup.js';
import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';
import { WRITER_PROVIDER_ID } from '../src/lib/integrations/google-sheets-writer-provider.js';

const ORG = '00000000-0000-0000-0000-000000000001';
const OTHER_ORG = '00000000-0000-0000-0000-000000000002';
const ID = '00000000-0000-0000-0000-0000000000aa';
const CONTACT = '00000000-0000-0000-0000-0000000000bb';

let repo;
beforeEach(async () => {
  supaRec.resultProvider = () => ({ data: [], error: null });
  supaRec.rpcCalls = [];
  supaRec.rpcProvider = null;
  ({ sheetExportRepository: repo } = await import('../src/repositories/sheet-export.repository.js'));
});

describe('enqueue / claim (RPC param pass-through)', () => {
  it('enqueue calls sheet_export_enqueue with p_org/p_since and returns the count', async () => {
    supaRec.rpcProvider = () => ({ data: 3, error: null });
    const n = await repo.enqueue(ORG, '2026-08-01T00:00:00.000Z');
    const call = supaRec.rpcCalls.at(-1);
    expect(call.fn).toBe('sheet_export_enqueue');
    expect(call.params).toEqual({ p_org: ORG, p_since: '2026-08-01T00:00:00.000Z' });
    expect(n).toBe(3);
  });

  it('enqueue carries p_org for a second org too (cross-org isolation)', async () => {
    supaRec.rpcProvider = () => ({ data: 0, error: null });
    await repo.enqueue(OTHER_ORG, '2026-08-01T00:00:00.000Z');
    expect(supaRec.rpcCalls.at(-1).params.p_org).toBe(OTHER_ORG);
  });

  it('claim passes limit/includeNoMatch/ignoreBackoff through as RPC params', async () => {
    supaRec.rpcProvider = () => ({ data: [{ id: ID }], error: null });
    const rows = await repo.claim(ORG, { limit: 25, includeNoMatch: true, ignoreBackoff: true });
    const call = supaRec.rpcCalls.at(-1);
    expect(call.fn).toBe('sheet_export_claim');
    expect(call.params).toEqual({ p_org: ORG, p_limit: 25, p_include_no_match: true, p_ignore_backoff: true });
    expect(rows).toEqual([{ id: ID }]);
  });

  it('claim defaults limit=50 includeNoMatch=false ignoreBackoff=false', async () => {
    supaRec.rpcProvider = () => ({ data: null, error: null });
    const rows = await repo.claim(ORG, {});
    expect(supaRec.rpcCalls.at(-1).params).toEqual({ p_org: ORG, p_limit: 50, p_include_no_match: false, p_ignore_backoff: false });
    expect(rows).toEqual([]);
  });

  it('claim carries p_org for a second org too (cross-org isolation)', async () => {
    supaRec.rpcProvider = () => ({ data: [], error: null });
    await repo.claim(OTHER_ORG, {});
    expect(supaRec.rpcCalls.at(-1).params.p_org).toBe(OTHER_ORG);
  });
});

describe('markExported / markNoMatch / recordMatch — org scoping', () => {
  it('markExported updates status=exported + exported_at, scoped to org and .in(ids)', async () => {
    await repo.markExported(ORG, [ID]);
    expect(supaRec.last.table).toBe('sheet_export_queue');
    expect(supaRec.last.op).toBe('update');
    expect(supaRec.last.updateVals.status).toBe('exported');
    expect(supaRec.last.updateVals.exported_at).toBeTruthy();
    expect(supaRec.last.eqs).toContainEqual({ col: 'organisation_id', val: ORG });
    expect(supaRec.last.ins).toContainEqual({ col: 'id', vals: [ID] });
  });

  it('markExported scopes to a different org too (cross-org isolation)', async () => {
    await repo.markExported(OTHER_ORG, [ID]);
    expect(supaRec.last.eqs).toContainEqual({ col: 'organisation_id', val: OTHER_ORG });
    expect(supaRec.last.eqs).not.toContainEqual({ col: 'organisation_id', val: ORG });
  });

  it('markNoMatch updates status=no_match + last_error, scoped to org+id', async () => {
    await repo.markNoMatch(ORG, ID, 'no candidates');
    expect(supaRec.last.updateVals.status).toBe('no_match');
    expect(supaRec.last.updateVals.last_error).toBe('no candidates');
    expect(supaRec.last.eqs).toContainEqual({ col: 'organisation_id', val: ORG });
    expect(supaRec.last.eqs).toContainEqual({ col: 'id', val: ID });
  });

  it('recordMatch updates matched_contact_id/matched_lead_id, scoped to org+id', async () => {
    await repo.recordMatch(ORG, ID, 'contact-1', 'lead-1');
    expect(supaRec.last.updateVals.matched_contact_id).toBe('contact-1');
    expect(supaRec.last.updateVals.matched_lead_id).toBe('lead-1');
    expect(supaRec.last.eqs).toContainEqual({ col: 'organisation_id', val: ORG });
    expect(supaRec.last.eqs).toContainEqual({ col: 'id', val: ID });
  });
});

describe('markRetry — backoff/failure branch', () => {
  it('below 10 attempts goes back to pending with attempts+1', async () => {
    supaRec.resultProvider = (q) => {
      if (q.op === 'select') return { data: { attempts: 8 }, error: null };
      return { data: null, error: null };
    };
    const result = await repo.markRetry(ORG, ID, 'transient error');
    expect(result).toEqual({ status: 'pending', attempts: 9 });
    expect(supaRec.last.op).toBe('update');
    expect(supaRec.last.updateVals.status).toBe('pending');
    expect(supaRec.last.updateVals.attempts).toBe(9);
    expect(supaRec.last.updateVals.last_error).toBe('transient error');
    expect(supaRec.last.eqs).toContainEqual({ col: 'organisation_id', val: ORG });
    expect(supaRec.last.eqs).toContainEqual({ col: 'id', val: ID });
  });

  it('at attempts >= 10 flips to failed', async () => {
    supaRec.resultProvider = (q) => {
      if (q.op === 'select') return { data: { attempts: 9 }, error: null };
      return { data: null, error: null };
    };
    const result = await repo.markRetry(ORG, ID, 'still broken');
    expect(result).toEqual({ status: 'failed', attempts: 10 });
    expect(supaRec.last.updateVals.status).toBe('failed');
    expect(supaRec.last.updateVals.attempts).toBe(10);
  });

  it('truncates last_error to 500 chars', async () => {
    supaRec.resultProvider = (q) => {
      if (q.op === 'select') return { data: { attempts: 0 }, error: null };
      return { data: null, error: null };
    };
    const long = 'x'.repeat(600);
    await repo.markRetry(ORG, ID, long);
    expect(supaRec.last.updateVals.last_error).toHaveLength(500);
  });

  it('handles a missing row (no prior attempts) as attempts=0 -> 1', async () => {
    supaRec.resultProvider = (q) => {
      if (q.op === 'select') return { data: null, error: null };
      return { data: null, error: null };
    };
    const result = await repo.markRetry(ORG, ID, 'err');
    expect(result).toEqual({ status: 'pending', attempts: 1 });
  });

  it('markRetry select+update both scope to a second org too (cross-org isolation)', async () => {
    supaRec.resultProvider = (q) => {
      if (q.op === 'select') {
        expect(q.eqs).toContainEqual({ col: 'organisation_id', val: OTHER_ORG });
        return { data: { attempts: 1 }, error: null };
      }
      return { data: null, error: null };
    };
    await repo.markRetry(OTHER_ORG, ID, 'err');
    expect(supaRec.last.eqs).toContainEqual({ col: 'organisation_id', val: OTHER_ORG });
  });
});

describe('counts', () => {
  it('returns pending/processing/exported/no_match/failed counts, each scoped to org', async () => {
    const seen = [];
    supaRec.resultProvider = (q) => {
      seen.push(q.eqs);
      const status = q.eqs.find((e) => e.col === 'status')?.val;
      const map = { pending: 4, processing: 1, exported: 10, no_match: 2, failed: 0 };
      return { data: null, count: map[status] ?? 0, error: null };
    };
    const counts = await repo.counts(ORG);
    expect(counts).toEqual({ pending: 4, processing: 1, exported: 10, no_match: 2, failed: 0 });
    for (const eqs of seen) {
      expect(eqs).toContainEqual({ col: 'organisation_id', val: ORG });
    }
  });
});

describe('getContact', () => {
  it('selects the minimal contact fields, scoped to org+id', async () => {
    supaRec.resultProvider = () => ({
      data: { id: CONTACT, first_name: 'A', last_name: 'B', email: 'a@b.com', phone: '+447', pms_external_id: 'p1' },
      error: null,
    });
    const row = await repo.getContact(ORG, CONTACT);
    expect(supaRec.last.table).toBe('contacts');
    expect(supaRec.last.select).toBe('id, first_name, last_name, email, phone, pms_external_id');
    expect(supaRec.last.eqs).toContainEqual({ col: 'organisation_id', val: ORG });
    expect(supaRec.last.eqs).toContainEqual({ col: 'id', val: CONTACT });
    expect(row.id).toBe(CONTACT);
  });

  it('returns null when no row found', async () => {
    supaRec.resultProvider = () => ({ data: null, error: null });
    const row = await repo.getContact(ORG, CONTACT);
    expect(row).toBeNull();
  });
});

describe('ghlCandidatesByEmail — ilike escaping + org scoping', () => {
  it('escapes % and _ and backslash before ilike, no wildcards added', async () => {
    supaRec.resultProvider = () => ({ data: [{ id: CONTACT }], error: null });
    const rows = await repo.ghlCandidatesByEmail(ORG, 'a_b%c\\d@example.com');
    expect(supaRec.last.table).toBe('contacts');
    expect(supaRec.last.eqs).toContainEqual({ col: 'organisation_id', val: ORG });
    expect(supaRec.last.nots).toContainEqual({ col: 'ghl_contact_id', op: 'is', val: null });
    expect(supaRec.last.ilikes).toContainEqual({ col: 'email', val: 'a\\_b\\%c\\\\d@example.com' });
    expect(rows).toEqual([{ id: CONTACT }]);
  });

  it('scopes to a second org too (cross-org isolation)', async () => {
    supaRec.resultProvider = () => ({ data: [], error: null });
    await repo.ghlCandidatesByEmail(OTHER_ORG, 'x@y.com');
    expect(supaRec.last.eqs).toContainEqual({ col: 'organisation_id', val: OTHER_ORG });
  });
});

describe('ghlCandidatesByPhone (RPC)', () => {
  it('calls sheet_export_phone_candidates with p_org/p_digits', async () => {
    supaRec.rpcProvider = () => ({ data: [{ id: CONTACT }], error: null });
    const rows = await repo.ghlCandidatesByPhone(ORG, '712345678');
    const call = supaRec.rpcCalls.at(-1);
    expect(call.fn).toBe('sheet_export_phone_candidates');
    expect(call.params).toEqual({ p_org: ORG, p_digits: '712345678' });
    expect(rows).toEqual([{ id: CONTACT }]);
  });

  it('carries p_org for a second org too (cross-org isolation)', async () => {
    supaRec.rpcProvider = () => ({ data: [], error: null });
    await repo.ghlCandidatesByPhone(OTHER_ORG, '712345678');
    expect(supaRec.rpcCalls.at(-1).params.p_org).toBe(OTHER_ORG);
  });
});

describe('pipelineLeads', () => {
  it('filters ghl_pipeline_id not null, .in(contact_id), ordered created_at asc, scoped to org', async () => {
    supaRec.resultProvider = () => ({ data: [{ id: 'l1', contact_id: CONTACT }], error: null });
    const rows = await repo.pipelineLeads(ORG, [CONTACT]);
    expect(supaRec.last.table).toBe('leads');
    expect(supaRec.last.eqs).toContainEqual({ col: 'organisation_id', val: ORG });
    expect(supaRec.last.nots).toContainEqual({ col: 'ghl_pipeline_id', op: 'is', val: null });
    expect(supaRec.last.ins).toContainEqual({ col: 'contact_id', vals: [CONTACT] });
    expect(supaRec.last.order).toEqual({ col: 'created_at', opts: { ascending: true } });
    expect(rows).toEqual([{ id: 'l1', contact_id: CONTACT }]);
  });

  it('scopes to a second org too (cross-org isolation)', async () => {
    supaRec.resultProvider = () => ({ data: [], error: null });
    await repo.pipelineLeads(OTHER_ORG, [CONTACT]);
    expect(supaRec.last.eqs).toContainEqual({ col: 'organisation_id', val: OTHER_ORG });
  });
});

describe('practices', () => {
  it('returns id/name scoped to org', async () => {
    supaRec.resultProvider = () => ({ data: [{ id: 'pr1', name: 'Barnet' }], error: null });
    const rows = await repo.practices(ORG);
    expect(supaRec.last.table).toBe('practices');
    expect(supaRec.last.eqs).toContainEqual({ col: 'organisation_id', val: ORG });
    expect(rows).toEqual([{ id: 'pr1', name: 'Barnet' }]);
  });
});

describe('orgsWithWriter — the one deliberate cross-org read (worker-only)', () => {
  it('selects organisation_id only, filtered by the writer provider id and status != revoked', async () => {
    supaRec.resultProvider = () => ({
      data: [{ organisation_id: ORG }, { organisation_id: OTHER_ORG }, { organisation_id: ORG }],
      error: null,
    });
    const orgs = await repo.orgsWithWriter();
    expect(supaRec.last.table).toBe('integrations');
    expect(supaRec.last.select).toBe('organisation_id');
    expect(supaRec.last.eqs).toContainEqual({ col: 'provider', val: WRITER_PROVIDER_ID });
    expect(supaRec.last.neqs).toContainEqual({ col: 'status', val: 'revoked' });
    // deduped, no per-org filter (this is the deliberate exception to rule 3)
    expect(orgs.sort()).toEqual([ORG, OTHER_ORG].sort());
  });
});
