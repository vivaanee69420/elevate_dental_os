// ============================================================================
// Lead export — the paging behind GET /api/leads/export.csv.
//
// PipelineScreen loads leads with `useLeads({ ..., limit: 500 })`, which is
// exactly PostgREST's page-size trap: a naive CSV built from that array would
// silently truncate any pipeline past 500 rows. `leadRepository.exportBatches`
// exists so the export never does that — it pages past PostgREST's 1000-row
// hard cap on its own, driven purely by page SIZE (never trusting a returned
// total), and stops only once a page comes back SHORT of a full page.
//
// The assertion that actually proves paging happened is the READ COUNT
// (`reads` / how many times the fake `.from('leads')` provider fired) —
// asserting only the summed row total would still pass a broken
// single-request implementation whose test double happens to hand back every
// row on the first call.
// ============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import './setup.js';
import { supaRec } from './setup.js';

vi.mock('../src/lib/integration-gating.js', () => ({
  crmHidden: vi.fn(async () => false),
}));

const { leadRepository } = await import('../src/repositories/lead.repository.js');

const ORG_A = '11111111-1111-1111-1111-111111111111';
const ORG_B = '22222222-2222-2222-2222-222222222222';

function makeLeads(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `lead-${String(i).padStart(5, '0')}`,
    created_at: '2026-01-01T00:00:00.000Z',
    status: 'new',
    treatment: 'Dental implants',
    estimated_value_pence: 250000,
    source: 'facebook',
    utm_source: null,
    utm_medium: null,
    utm_campaign: null,
    ghl_pipeline_id: 'pipe-1',
    ghl_pipeline_stage_id: 'stage-1',
    ghl_stage_name: 'New',
    contact: { first_name: 'Jane', last_name: 'Doe', email: 'jane@example.com', phone: '+447700900000' },
    practice: { name: 'Bexleyheath' },
    assignee: null,
  }));
}

beforeEach(() => {
  supaRec.resultProvider = () => ({ data: [], error: null });
});

describe('leadRepository.exportBatches — org scope', () => {
  it('carries .eq(organisation_id) on every page it reads, not just the first', async () => {
    const leads = makeLeads(1500); // forces a 2nd page
    let calls = 0;
    supaRec.resultProvider = (q) => {
      calls += 1;
      expect(q.table).toBe('leads');
      expect(q.eqs).toContainEqual({ col: 'organisation_id', val: ORG_A });
      // never the other tenant's id, on any page
      expect(q.eqs.find((e) => e.col === 'organisation_id').val).not.toBe(ORG_B);
      return { data: leads, error: null };
    };
    const collected = [];
    await leadRepository.exportBatches(ORG_A, {}, (batch) => collected.push(...batch));
    expect(calls).toBe(2); // proves this assertion actually ran on page 2
  });

  it('applies the board filters (pipeline, subaccount, status …) on every page', async () => {
    supaRec.resultProvider = (q) => {
      expect(q.eqs).toContainEqual({ col: 'ghl_pipeline_id', val: 'pipe-9' });
      expect(q.eqs).toContainEqual({ col: 'integration_account_id', val: 'acct-1' });
      expect(q.eqs).toContainEqual({ col: 'status', val: 'new' });
      return { data: [], error: null };
    };
    await leadRepository.exportBatches(
      ORG_A,
      { ghl_pipeline_id: 'pipe-9', integration_account_id: 'acct-1', status: 'new' },
      () => {},
    );
  });
});

describe('leadRepository.exportBatches — paging past the 1000-row cap', () => {
  it('pages past the cap and stops on the short final page (asserts READ COUNT)', async () => {
    const leads = makeLeads(1500); // 1000 (full) + 500 (short) — never a 3rd empty read
    let providerCalls = 0;
    supaRec.resultProvider = () => {
      providerCalls += 1;
      return { data: leads, error: null };
    };
    const collected = [];
    const { rows, reads } = await leadRepository.exportBatches(ORG_A, {}, (batch) => collected.push(...batch));

    expect(reads).toBe(2);
    expect(providerCalls).toBe(2); // the fake `.from()` really fired twice
    expect(rows).toBe(1500);
    expect(collected).toHaveLength(1500); // no row lost, none duplicated
    // Every row present exactly once — a boundary bug (off-by-one range) would
    // either drop lead-00999/lead-01000 or repeat one of them.
    expect(new Set(collected.map((r) => r.id)).size).toBe(1500);
  });

  it('does a single read when the whole result set fits on one page', async () => {
    const leads = makeLeads(3);
    let providerCalls = 0;
    supaRec.resultProvider = () => { providerCalls += 1; return { data: leads, error: null }; };
    const { rows, reads } = await leadRepository.exportBatches(ORG_A, {}, () => {});
    expect(reads).toBe(1);
    expect(providerCalls).toBe(1);
    expect(rows).toBe(3);
  });

  it('an org with a page-size-multiple of rows still stops (never assumes one read is everything)', async () => {
    const leads = makeLeads(2000); // exactly 2 full pages: a naive "short page" check must not stop early
    let providerCalls = 0;
    supaRec.resultProvider = () => { providerCalls += 1; return { data: leads, error: null }; };
    const { rows, reads } = await leadRepository.exportBatches(ORG_A, {}, () => {});
    // page 1: 1000 rows (full) -> continue; page 2: range(1000,1999) also 1000
    // (full) -> continue; page 3: range(2000,2999) -> empty -> stop.
    expect(reads).toBe(3);
    expect(providerCalls).toBe(3);
    expect(rows).toBe(2000);
  });

  it('returns zero rows and zero reads for an org whose CRM data is hidden (revoked GoHighLevel)', async () => {
    const { crmHidden } = await import('../src/lib/integration-gating.js');
    vi.mocked(crmHidden).mockResolvedValueOnce(true);
    let providerCalls = 0;
    supaRec.resultProvider = () => { providerCalls += 1; return { data: makeLeads(5), error: null }; };
    const { rows, reads } = await leadRepository.exportBatches(ORG_A, {}, () => {});
    expect(rows).toBe(0);
    expect(reads).toBe(0);
    expect(providerCalls).toBe(0); // never even asked
  });
});
