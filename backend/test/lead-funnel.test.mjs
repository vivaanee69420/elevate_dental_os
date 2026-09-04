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
  it('passes the caller org and practice through, with the window normalised', async () => {
    const spy = stubCounts([]);
    await leadService.funnel(ORG_A, {
      since: '2026-01-01', until: '2026-09-03', practiceId: 'p-1',
    });
    const [org, args] = spy.mock.calls[0];
    expect(org).toBe(ORG_A);
    expect(args.practiceId).toBe('p-1');
    // The upper bound must be the END of 3 September. Passing the bare
    // 'YYYY-MM-DD' made it midnight at the START of that day, silently losing a
    // whole day of leads (44 of 1,429 for August; all of them on an MTD day 1).
    expect(new Date(args.until).getTime())
      .toBe(new Date(2026, 8, 3, 23, 59, 59, 999).getTime());
    expect(new Date(args.since).getTime())
      .toBe(new Date(2026, 0, 1, 0, 0, 0, 0).getTime());
  });

  it('a single-day window still covers that whole day', async () => {
    const spy = stubCounts([]);
    await leadService.funnel(ORG_A, { since: '2026-09-01', until: '2026-09-01' });
    const { since, until } = spy.mock.calls[0][1];
    expect(new Date(until).getTime() - new Date(since).getTime()).toBe(86_400_000 - 1);
  });

  it('no window at all stays unbounded rather than becoming an empty one', async () => {
    const spy = stubCounts([]);
    await leadService.funnel(ORG_A);
    const { since, until } = spy.mock.calls[0][1];
    expect(since).toBeNull();
    expect(until).toBeNull();
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

// ============================================================================
// CRM Reports — the same defect on a sibling screen, live at the time of the
// fix. It fetched `useLeads({ limit: 1000 })` and counted rows in the browser.
// 1000 is exactly PostgREST's cap, so it was a ceiling dressed as a choice.
// ============================================================================
describe('CRM Reports figures come from the aggregate, not a page of leads', () => {
  // The real Plan4growth all-time shape, from lead_report_aggregate.
  const REPORT_ROWS = [
    { dimension: 'all', key_id: null, key: '', total: 22807, contacted: 4506,
      consult_booked: 1200, consult_attended: 700, treatment_started: 494,
      not_proceeding: 8000, failed_to_attend: 18,
      converted_value_pence: 12_000_000, pipeline_value_pence: 646_081_311,
      response_minutes_sum: 6000, response_minutes_count: 300 },
    { dimension: 'source', key_id: null, key: 'gohighlevel', total: 22807,
      contacted: 4506, consult_booked: 1200, consult_attended: 700,
      treatment_started: 494, not_proceeding: 8000, failed_to_attend: 18,
      converted_value_pence: 12_000_000, pipeline_value_pence: 646_081_311,
      response_minutes_sum: 6000, response_minutes_count: 300 },
    { dimension: 'practice', key_id: 'p-roch', key: 'Rochester', total: 6697,
      contacted: 0, consult_booked: 0, consult_attended: 0,
      treatment_started: 132, not_proceeding: 0, failed_to_attend: 0,
      converted_value_pence: 0, pipeline_value_pence: 93_793_811,
      response_minutes_sum: 0, response_minutes_count: 0 },
    { dimension: 'practice', key_id: null, key: 'Unassigned', total: 3939,
      contacted: 0, consult_booked: 0, consult_attended: 0,
      treatment_started: 301, not_proceeding: 0, failed_to_attend: 0,
      converted_value_pence: 0, pipeline_value_pence: 308_744_600,
      response_minutes_sum: 0, response_minutes_count: 0 },
  ];
  const stubReport = (rows) =>
    vi.spyOn(leadRepository, 'reportAggregate').mockResolvedValue(rows);

  it('reports every lead, not the 1000-row page', async () => {
    stubReport(REPORT_ROWS);
    const r = await leadService.report(ORG_A);
    expect(r.totals.total).toBe(22807); // page showed 1000
    expect(r.funnel[0].count).toBe(22807);
  });

  it('the FTA rate is the real one, not the 0.00% truncation produced', async () => {
    stubReport(REPORT_ROWS);
    const r = await leadService.report(ORG_A);
    expect(r.totals.ftaPct).toBe(0.1); // 18/22807 -> 0.08 -> 0.1 at 1dp
    expect(r.totals.failedToAttend).toBe(18);
  });

  it('pipeline value is the full figure, not ~1/22 of it', async () => {
    stubReport(REPORT_ROWS);
    const r = await leadService.report(ORG_A);
    expect(r.totals.pipelineValuePence).toBe(646_081_311);
  });

  // The by-practice table grouped on `l.practice?.name` and dropped falsy
  // names, discarding 3,939 leads carrying 301 of the 494 conversions.
  it('leads with no practice get their own row instead of vanishing', async () => {
    stubReport(REPORT_ROWS);
    const r = await leadService.report(ORG_A);
    const unassigned = r.byPractice.find((p) => p.key === 'Unassigned');
    expect(unassigned).toBeDefined();
    expect(unassigned.total).toBe(3939);
    expect(unassigned.treatmentStarted).toBe(301);
  });

  it('the funnel never widens as it descends', async () => {
    stubReport(REPORT_ROWS);
    const r = await leadService.report(ORG_A);
    for (let i = 1; i < r.funnel.length; i++) {
      expect(r.funnel[i].count).toBeLessThanOrEqual(r.funnel[i - 1].count);
    }
  });

  it('average first response is a weighted mean, not an average of averages', async () => {
    stubReport(REPORT_ROWS);
    const r = await leadService.report(ORG_A);
    expect(r.totals.avgFirstResponseMinutes).toBe(20); // 6000 / 300
  });

  it('no response data → null, not a confident 0 minutes', async () => {
    stubReport([{ ...REPORT_ROWS[0], response_minutes_sum: 0, response_minutes_count: 0 }]);
    const r = await leadService.report(ORG_A);
    expect(r.totals.avgFirstResponseMinutes).toBeNull();
  });

  it('an empty org yields nulls and zeroes, never NaN', async () => {
    stubReport([]);
    const r = await leadService.report(ORG_A);
    expect(r.totals.total).toBe(0);
    expect(r.totals.conversionPct).toBeNull();
    expect(r.totals.ftaPct).toBeNull();
    expect(r.bySource).toEqual([]);
    expect(Number.isNaN(r.totals.pipelineValuePence)).toBe(false);
  });

  it('uses the shared day window, so the report cannot lose its final day', async () => {
    const spy = stubReport([]);
    await leadService.report(ORG_A, { since: '2026-08-01', until: '2026-08-31' });
    const args = spy.mock.calls[0][1];
    expect(new Date(args.until).getTime())
      .toBe(new Date(2026, 7, 31, 23, 59, 59, 999).getTime());
  });

  it('binds p_org server-side and scopes by ids, never names', async () => {
    const spy = stubReport([]);
    await leadService.report(ORG_B, { practiceId: 'p-1', accountId: 'a-1' });
    expect(spy.mock.calls[0][0]).toBe(ORG_B);
    expect(spy.mock.calls[0][1].practiceId).toBe('p-1');
    expect(spy.mock.calls[0][1].accountId).toBe('a-1');
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

  const report = readFileSync(
    join(SRC, '..', '..', 'supabase', 'migrations', '20260101000152_lead_report_aggregate.sql'),
    'utf8',
  );

  it('lead_report_aggregate is service_role only', () => {
    expect(report).toMatch(/REVOKE ALL ON FUNCTION lead_report_aggregate\(uuid, timestamptz, timestamptz, uuid, uuid\)\s*\n\s*FROM PUBLIC, anon, authenticated/);
    expect(report).toMatch(/GRANT EXECUTE ON FUNCTION lead_report_aggregate\(uuid, timestamptz, timestamptz, uuid, uuid\)\s*\n\s*TO service_role/);
  });

  it('lead_report_aggregate is org-scoped on its scan AND on its practice join', () => {
    expect(report).toMatch(/l\.organisation_id = \$1/);
    // The practice name join must carry the org predicate too — a join without
    // one is how the PostgREST embed leak happened.
    expect(report).toMatch(/LEFT JOIN practices pr ON pr\.id = a\.key_id AND pr\.organisation_id = \$1/);
  });

  it('lead_report_aggregate avoids the generic-plan trap', () => {
    expect(report).toMatch(/LANGUAGE plpgsql STABLE SECURITY DEFINER/);
    expect(report).toMatch(/USING p_org, p_since, p_until, p_practice, p_account/);
  });
});
