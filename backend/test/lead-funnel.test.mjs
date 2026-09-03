// ============================================================================
// Lead funnel — the two faults that made the Command Centre report a permanent
// 0% conversion rate on a real org.
//
// 1. TRUNCATION. The funnel was computed in the browser from `GET /api/leads`,
//    whose Zod default is `limit: 100` over ORDER BY created_at DESC. On
//    Plan4growth that meant the funnel, the "N leads" header and the headline
//    conversion rate all came from the 100 NEWEST leads out of 1,388 in the
//    window. Brand-new leads have not converted yet, so the page reported
//    0.0% against a real 3.5% — pinned to zero by construction, not merely
//    imprecise. The second lead path (`funnelRows`) selected the whole table
//    with no .limit(), so PostgREST's 1000-row cap applied to it instead.
//
// 2. LOST LEADS VANISHED. Stages are cumulative, and the old client code tested
//    `allStages.slice(i).includes(status)`. `not_proceeding` is not a stage, so
//    it matched at NO index — a lost lead disappeared from every stage
//    including "New". That hid 415 of 1,388 leads (30%), so the funnel's top
//    bar read 973 beside a header that said 1,388.
//
// Both faults are now impossible: counts come from a SQL aggregate (at most one
// row per status), and terminal statuses map back onto the funnel.
// ============================================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import './setup.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

vi.mock('../src/lib/integration-gating.js', () => ({
  crmHidden: async () => false,
  revokedProviders: async () => [],
  pmsHidden: async () => false,
  emergentConnected: async () => true,
  groupReceiptExcludedSources: async () => [],
  domainHidden: async () => false,
  isActive: async () => true,
}));

const { leadService } = await import('../src/services/lead.service.js');
const { furthestStageIndex, FUNNEL_STAGES } = await import('../src/models/lead.model.js');
const { leadRepository } = await import('../src/repositories/lead.repository.js');

const ORG_A = '11111111-1111-1111-1111-111111111111';
const ORG_B = '22222222-2222-2222-2222-222222222222';

// The real Plan4growth 30-day distribution that exposed both faults.
const LIVE_SHAPE = [
  { status: 'new', n: 545, value_pence: 0 },
  { status: 'not_proceeding', n: 415, value_pence: 0 },
  { status: 'contact_attempted', n: 137, value_pence: 0 },
  { status: 'consultation_booked', n: 136, value_pence: 0 },
  { status: 'contact_made', n: 103, value_pence: 0 },
  { status: 'treatment_started', n: 49, value_pence: 0 },
  { status: 'consultation_attended', n: 3, value_pence: 0 },
];

function stubCounts(rows) {
  return vi.spyOn(leadRepository, 'funnelCounts').mockResolvedValue(rows);
}

beforeEach(() => vi.restoreAllMocks());

describe('the funnel counts every lead, not a page of them', () => {
  it('total matches the real window, not the 100-row list default', async () => {
    stubCounts(LIVE_SHAPE);
    const r = await leadService.funnel(ORG_A);
    expect(r.total).toBe(1388);
  });

  it('reports the real conversion rate, not the 0% truncation produced', async () => {
    stubCounts(LIVE_SHAPE);
    const r = await leadService.funnel(ORG_A);
    expect(r.started).toBe(49);
    expect(r.conversionPct).toBe(3.5);
  });

  it('no lead count is capped at 100 or 1000', async () => {
    stubCounts([{ status: 'new', n: 22768, value_pence: 0 }]);
    const r = await leadService.funnel(ORG_A);
    expect(r.total).toBe(22768);
    expect(r.stages[0].count).toBe(22768);
  });
});

describe('lost leads stay in the funnel', () => {
  it('the top stage equals the total lead count', async () => {
    stubCounts(LIVE_SHAPE);
    const r = await leadService.funnel(ORG_A);
    // The old client code gave 973 here against a header of 1388.
    expect(r.stages[0].count).toBe(r.total);
    expect(r.stages[0].count).toBe(1388);
  });

  it('the 415 not_proceeding leads are reported, not silently dropped', async () => {
    stubCounts(LIVE_SHAPE);
    const r = await leadService.funnel(ORG_A);
    expect(r.lost).toBe(415);
  });

  it('failed_to_attend counts as lost too', async () => {
    stubCounts([
      { status: 'new', n: 5, value_pence: 0 },
      { status: 'failed_to_attend', n: 2, value_pence: 0 },
    ]);
    const r = await leadService.funnel(ORG_A);
    expect(r.lost).toBe(2);
    expect(r.stages[0].count).toBe(7);
  });
});

describe('stages are cumulative and monotonically non-increasing', () => {
  it('a lead counts at its stage and every stage before it', async () => {
    stubCounts([{ status: 'treatment_started', n: 10, value_pence: 0 }]);
    const r = await leadService.funnel(ORG_A);
    for (const s of r.stages) expect(s.count).toBe(10);
  });

  it('treatment_completed reaches the final stage', async () => {
    stubCounts([{ status: 'treatment_completed', n: 4, value_pence: 0 }]);
    const r = await leadService.funnel(ORG_A);
    expect(r.stages[r.stages.length - 1].count).toBe(4);
    expect(r.started).toBe(4);
  });

  // A funnel that widens further down is arithmetically impossible.
  it('never widens as it descends', async () => {
    stubCounts(LIVE_SHAPE);
    const r = await leadService.funnel(ORG_A);
    for (let i = 1; i < r.stages.length; i++) {
      expect(r.stages[i].count).toBeLessThanOrEqual(r.stages[i - 1].count);
    }
  });

  it('places a terminal lead at the top only — never deeper than we can prove', () => {
    // We do not know where a lost lead died (GHL sends no stage history), so it
    // is placed at index 0. Anything deeper would invent progress.
    expect(furthestStageIndex('not_proceeding')).toBe(0);
    expect(furthestStageIndex('failed_to_attend')).toBe(0);
    expect(furthestStageIndex('treatment_completed')).toBe(FUNNEL_STAGES.length - 1);
    expect(furthestStageIndex('nonsense_status')).toBe(-1);
  });
});

describe('empty and edge windows are honest', () => {
  it('no leads → conversion is null, not 0%', async () => {
    stubCounts([]);
    const r = await leadService.funnel(ORG_A);
    expect(r.total).toBe(0);
    expect(r.conversionPct).toBeNull();
    expect(r.stages.every((s) => s.count === 0)).toBe(true);
  });

  it('an unknown status still counts toward the total', async () => {
    stubCounts([
      { status: 'new', n: 3, value_pence: 0 },
      { status: 'some_future_status', n: 2, value_pence: 0 },
    ]);
    const r = await leadService.funnel(ORG_A);
    expect(r.total).toBe(5); // never under-report the denominator
  });
});

describe('tenant and scope isolation', () => {
  it('passes the caller org, window and practice straight to the RPC', async () => {
    const spy = stubCounts([]);
    await leadService.funnel(ORG_A, {
      since: '2026-01-01', until: '2026-09-03', practiceId: 'p-1',
    });
    expect(spy).toHaveBeenCalledWith(ORG_A, {
      since: '2026-01-01', until: '2026-09-03', practiceId: 'p-1',
    });
  });

  it('one org cannot be asked for another org’s funnel', async () => {
    const spy = stubCounts([]);
    await leadService.funnel(ORG_B);
    expect(spy.mock.calls[0][0]).toBe(ORG_B);
  });

  it('the repository binds p_org server-side and never takes it from a caller param', () => {
    const repo = readFileSync(join(SRC, 'repositories', 'lead.repository.js'), 'utf8');
    const fn = repo.slice(repo.indexOf('async funnelCounts'));
    expect(fn.slice(0, 600)).toMatch(/rpc\('lead_funnel_counts', \{\s*p_org: orgId/);
  });

  it('scope is a practice id, never a practice name', () => {
    const repo = readFileSync(join(SRC, 'repositories', 'lead.repository.js'), 'utf8');
    const fn = repo.slice(repo.indexOf('async funnelCounts'), repo.indexOf('async funnelCounts') + 600);
    expect(fn).toMatch(/p_practice: practiceId/);
    expect(fn).not.toMatch(/name/);
  });
});

describe('the migration is safe for every tenant', () => {
  const migration = readFileSync(
    join(SRC, '..', '..', 'supabase', 'migrations', '20260101000151_lead_funnel_counts.sql'),
    'utf8',
  );

  it('lead_funnel_counts is service_role only', () => {
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION lead_funnel_counts\(uuid, timestamptz, timestamptz, uuid\)\s*\n\s*FROM PUBLIC, anon, authenticated/);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION lead_funnel_counts\(uuid, timestamptz, timestamptz, uuid\)\s*\n\s*TO service_role/);
  });

  it('uses plpgsql + EXECUTE USING, avoiding the generic-plan trap', () => {
    expect(migration).toMatch(/LANGUAGE plpgsql STABLE SECURITY DEFINER/);
    expect(migration).toMatch(/RETURN QUERY EXECUTE/);
    expect(migration).toMatch(/USING p_org, p_since, p_until, p_practice/);
  });

  it('every branch is org-scoped', () => {
    expect(migration).toMatch(/l\.organisation_id = \$1/);
  });

  // A NULL p_exclude_sources made settled_receipts_by_day return ZERO ROWS,
  // silently reading a tenant's whole settled revenue as £0.
  it('closes the NULL-exclusion silent-zero on settled_receipts_by_day', () => {
    expect(migration).toMatch(/coalesce\(cardinality\(p_exclude_sources\), 0\) = 0/);
  });
});
