// ============================================================================
// Phase 3 persistence — valuation_inputs + chair_config + pl_sheets.
// Covers: field mapping round-trip, default fallback, chairAnalytics honoring
// saved config, pl_sheets CRUD org-scoping, and the CSV export renderer.
// ============================================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const svc = (await import('../src/services/analytics.service.js')).analyticsService;

const ORG = 'org-cfgcfgcfg';
const USER = 'user-1';

beforeEach(() => {
  supaRec.last = undefined;
  supaRec.resultProvider = () => ({ data: null, error: null });
});

describe('valuation_inputs', () => {
  it('getValuationInputs returns null when never configured', async () => {
    supaRec.resultProvider = () => ({ data: null, error: null });
    expect(await svc.getValuationInputs(ORG)).toBeNull();
  });

  it('getValuationInputs maps snake_case columns to the compute camelCase shape', async () => {
    supaRec.resultProvider = (q) =>
      q.table === 'valuation_inputs'
        ? { data: {
            reported_ebitda_pence: 50000000, addbacks_pence: 1000000,
            principal_salary_pence: 8000000, principal_multiple: 5,
            associate_multiple: 6, dso_multiple: 8, region_factor: 1.1,
            growth_rate_pct: 12, updated_at: '2026-06-06T00:00:00Z',
          }, error: null }
        : { data: null, error: null };
    const r = await svc.getValuationInputs(ORG);
    expect(r.reportedEbitdaPence).toBe(50000000);
    expect(r.addBacksPence).toBe(1000000);
    expect(r.principalSalaryPence).toBe(8000000);
    expect(r.dsoMultiple).toBe(8);
    expect(r.regionFactor).toBe(1.1);
    expect(r.growthRatePct).toBe(12);
  });

  it('saveValuationInputs upserts org-scoped snake_case row', async () => {
    let upsertVals;
    supaRec.resultProvider = (q) => {
      if (q.op === 'upsert') { upsertVals = q.upsertVals; return { data: null, error: null }; }
      // the follow-up getValuationInputs read
      return { data: {
        reported_ebitda_pence: 42, addbacks_pence: 0, principal_salary_pence: 0,
        principal_multiple: 0, associate_multiple: 0, dso_multiple: 0,
        region_factor: 1, growth_rate_pct: 10, updated_at: 'x',
      }, error: null };
    };
    await svc.saveValuationInputs(ORG, {
      reportedEbitdaPence: 42, addBacksPence: 0, principalSalaryPence: 0,
      principalMultiple: 0, associateMultiple: 0, dsoMultiple: 0,
      regionFactor: 1, growthRatePct: 10,
    }, USER);
    expect(upsertVals.organisation_id).toBe(ORG);
    expect(upsertVals.reported_ebitda_pence).toBe(42);
    expect(upsertVals.updated_by).toBe(USER);
  });

  it('saveValuationInputs persists the UI-only ui_state blob verbatim', async () => {
    let upsertVals;
    supaRec.resultProvider = (q) => {
      if (q.op === 'upsert') { upsertVals = q.upsertVals; return { data: null, error: null }; }
      return { data: { reported_ebitda_pence: 1, addbacks_pence: 0, principal_salary_pence: 0, principal_multiple: 0, associate_multiple: 0, dso_multiple: 0, region_factor: 1, growth_rate_pct: 10, ui_state: { region: 'london' }, updated_at: 'x' }, error: null };
    };
    const r = await svc.saveValuationInputs(ORG, {
      reportedEbitdaPence: 1, addBacksPence: 0, principalSalaryPence: 0,
      principalMultiple: 0, associateMultiple: 0, dsoMultiple: 0,
      regionFactor: 1, growthRatePct: 10, uiState: { region: 'london' },
    }, USER);
    expect(upsertVals.ui_state).toEqual({ region: 'london' });
    expect(r.uiState).toEqual({ region: 'london' });
  });
});

describe('chair_config', () => {
  it('getChairConfig falls back to CHAIR_CONFIG defaults when unset', async () => {
    supaRec.resultProvider = () => ({ data: null, error: null });
    const c = await svc.getChairConfig(ORG);
    expect(c.openHrs).toBe(8);
    expect(c.weeksYr).toBe(46);
    expect(c.daysWk).toBe(5);
    expect(c.benchOccPct).toBe(88);
    expect(c.benchRevHrPence).toBe(30000);
    expect(c.isDefault).toBe(true);
  });

  it('getChairConfig overlays the saved row', async () => {
    supaRec.resultProvider = (q) =>
      q.table === 'chair_config'
        ? { data: { open_hrs: 9, weeks_yr: 48, days_wk: 5, bench_occ_pct: 90, bench_rev_hr_pence: 35000, updated_at: 'x' }, error: null }
        : { data: null, error: null };
    const c = await svc.getChairConfig(ORG);
    expect(c.openHrs).toBe(9);
    expect(c.weeksYr).toBe(48);
    expect(c.benchRevHrPence).toBe(35000);
    expect(c.isDefault).toBe(false);
  });

  it('chairAnalytics honours saved openHrs/weeks in capacity', async () => {
    const PRACTICES = [{ id: 'p1', name: 'A', kind: 'practice', chairs: 6, assumed_util_pct: 80 }];
    supaRec.rpcProvider = () => ({ data: [], error: null });
    supaRec.resultProvider = (q) => {
      if (q.table === 'practices') return { data: PRACTICES, error: null };
      // p1 needs a manual grid to be "live" (empty grid -> zero capacity).
      if (q.table === 'chair_utilisation') return { data: [{ practice_id: 'p1', booked_minutes: 1000, available_minutes: 2000 }], error: null };
      if (q.table === 'chair_config') return { data: { open_hrs: 10, weeks_yr: 46, days_wk: 5, bench_occ_pct: 88, bench_rev_hr_pence: 30000 }, error: null };
      return { data: [], error: null };
    };
    const r = await svc.chairAnalytics(ORG, { scope: 'all', now: () => new Date(Date.UTC(2026, 4, 15)) });
    expect(r.applicable).toBe(true);
    // capHrsYr = chairs(6) * openHrs(10) * workDays(46*5=230) = 13800
    expect(r.practices[0].capHrsYr).toBe(13800);
    expect(r.config.openHrs).toBe(10);
  });
});

describe('pl_sheets', () => {
  it('createPlSheet inserts an org-scoped row with created_by', async () => {
    let insertVals;
    supaRec.resultProvider = (q) => {
      // .select().single() resets q.op to 'select'; key off q.insertVals instead.
      if (q.table === 'pl_sheets' && q.insertVals) { insertVals = q.insertVals; return { data: { id: 's1', ...q.insertVals }, error: null }; }
      return { data: null, error: null };
    };
    await svc.createPlSheet(ORG, { name: 'Budget 2026', type: 'budget', cols: [], lines: [], cells: {} }, USER);
    expect(insertVals.organisation_id).toBe(ORG);
    expect(insertVals.name).toBe('Budget 2026');
    expect(insertVals.created_by).toBe(USER);
    expect(insertVals.updated_by).toBe(USER);
  });

  it('getPlSheet is org + id scoped', async () => {
    supaRec.resultProvider = () => ({ data: { id: 's1', name: 'X' }, error: null });
    await svc.getPlSheet(ORG, 's1');
    const cols = supaRec.last.eqs.map((e) => e.col);
    expect(cols).toContain('organisation_id');
    expect(cols).toContain('id');
  });

  it('deletePlSheet filters organisation_id + id', async () => {
    supaRec.resultProvider = () => ({ data: null, error: null });
    await svc.deletePlSheet(ORG, 's1');
    expect(supaRec.last.op).toBe('delete');
    const eqs = Object.fromEntries(supaRec.last.eqs.map((e) => [e.col, e.val]));
    expect(eqs.organisation_id).toBe(ORG);
    expect(eqs.id).toBe('s1');
  });
});

describe('plSheetToCsv', () => {
  it('renders lines x cols with £ from pence and escapes commas', async () => {
    const sheet = {
      name: 'My, Sheet',
      cols: [{ id: 'c1', label: 'Jan' }, { id: 'c2', label: 'Feb' }],
      lines: [{ id: 'l1', label: 'Revenue' }, { id: 'l2', label: 'Costs' }],
      cells: { 'l1:c1': 1000000, 'l1:c2': 1200000, 'l2:c1': -300000 },
    };
    const { filename, csv } = svc.plSheetToCsv(sheet);
    expect(filename).toBe('my-sheet.csv');
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe('Line,Jan,Feb');
    expect(lines[1]).toBe('Revenue,10000.00,12000.00');
    expect(lines[2]).toBe('Costs,-3000.00,');   // l2:c2 missing -> blank
  });
});
