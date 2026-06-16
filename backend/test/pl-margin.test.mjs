// ============================================================================
// plMargin service (P&L & Margin, GM Intelligence OS T11). Scope/period-aware
// group P&L statement + per-entity breakdown from REAL monthly_financials
// actuals (Xero/QuickBooks override manual). Honest CoA bucket granularity:
// revenue, lab+materials, staff (incl. associate pay), other opex; tax excluded.
// ============================================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const svc = (await import('../src/services/analytics.service.js')).analyticsService;

const ORG = 'org-pppppppp';
const now = () => new Date(Date.UTC(2026, 4, 15)); // 2026-05-15

const ENTITIES = [
  { id: 'p1', name: 'Rochester', kind: 'practice' },
  { id: 'p2', name: 'Barnet', kind: 'practice' },
  { id: 'ac', name: 'Academy', kind: 'academy' },
];

// monthly_financials rows for May 2026.
const FIN_MAY = [
  { practice_id: 'p1', period: '2026-05', dental_bucket: 'revenue', amount_pence: 1000000, source: 'xero' },
  { practice_id: 'p1', period: '2026-05', dental_bucket: 'lab', amount_pence: 100000, source: 'xero' },
  { practice_id: 'p1', period: '2026-05', dental_bucket: 'staff', amount_pence: 300000, source: 'xero' },
  { practice_id: 'p1', period: '2026-05', dental_bucket: 'overhead', amount_pence: 200000, source: 'xero' },
  { practice_id: 'p2', period: '2026-05', dental_bucket: 'revenue', amount_pence: 500000, source: 'manual' },
  { practice_id: 'p2', period: '2026-05', dental_bucket: 'staff', amount_pence: 200000, source: 'manual' },
];

beforeEach(() => {
  supaRec.last = undefined;
  supaRec.rpcCalls = [];
  supaRec.resultProvider = () => ({ data: [], error: null });
  supaRec.rpcProvider = () => ({ data: [], error: null });
});

function stub(fin) {
  supaRec.resultProvider = (q) => {
    if (q.table === 'practices') return { data: ENTITIES, error: null };
    if (q.table === 'monthly_financials') return { data: fin, error: null };
    return { data: [], error: null };
  };
}

describe('plMargin', () => {
  it('group statement + per-entity P&L from the selected month actuals', async () => {
    stub(FIN_MAY);
    const r = await svc.plMargin(ORG, { scope: 'all', period: 'month', periodKey: '2026-05', now });

    expect(r.applicable).toBe(true);
    expect(r.hasData).toBe(true);
    expect(r.basis).toBe('actuals-month');
    expect(r.dentistStaffSeparable).toBe(false);

    // Group = p1 + p2 summed.
    expect(r.statement.revPence).toBe(1500000);
    expect(r.statement.labMaterialsPence).toBe(100000);
    expect(r.statement.grossPence).toBe(1400000);
    expect(r.statement.staffPence).toBe(500000);
    expect(r.statement.otherOpexPence).toBe(200000);
    expect(r.statement.netPence).toBe(700000);

    // Per-entity, sorted by revenue desc (p1 then p2).
    expect(r.perEntityAvailable).toBe(true);
    expect(r.entities.map((e) => e.id)).toEqual(['p1', 'p2']);
    const p1 = r.entities[0];
    expect(p1).toMatchObject({ name: 'Rochester', revPence: 1000000, netPence: 400000, marginPct: 40 });
  });

  it('entity scope filters to the one practice', async () => {
    stub(FIN_MAY);
    const r = await svc.plMargin(ORG, { scope: 'p2', period: 'month', periodKey: '2026-05', now });
    expect(r.statement.revPence).toBe(500000);
    expect(r.entities.map((e) => e.id)).toEqual(['p2']);
    expect(r.entities[0].netPence).toBe(300000);
  });

  it('breakdown drills each summary line into its account_code lines (QuickBooks shape)', async () => {
    // QBO posts per company (integration_account_id), every P&L line as its own
    // account_code row. Mirror the client report: Sales + a contra refund, two
    // CoS lines (lab + materials), associate + salary on the staff line, and two
    // overhead expenses — each must land under the right summary line, sorted desc.
    const qbo = [
      { integration_account_id: 'co1', period: '2026-05', account_code: 'Sales', dental_bucket: 'revenue', amount_pence: 23978126, source: 'quickbooks', accounting_method: 'accrual' },
      { integration_account_id: 'co1', period: '2026-05', account_code: 'Patient Refund', dental_bucket: 'revenue', amount_pence: -35000, source: 'quickbooks', accounting_method: 'accrual' },
      { integration_account_id: 'co1', period: '2026-05', account_code: 'Lab fees', dental_bucket: 'lab', amount_pence: 1761900, source: 'quickbooks', accounting_method: 'accrual' },
      { integration_account_id: 'co1', period: '2026-05', account_code: 'Dental Materials', dental_bucket: 'materials', amount_pence: 452925, source: 'quickbooks', accounting_method: 'accrual' },
      { integration_account_id: 'co1', period: '2026-05', account_code: 'Associate Salary', dental_bucket: 'associates', amount_pence: 9446497, source: 'quickbooks', accounting_method: 'accrual' },
      { integration_account_id: 'co1', period: '2026-05', account_code: 'Salaries', dental_bucket: 'staff', amount_pence: 1988388, source: 'quickbooks', accounting_method: 'accrual' },
      { integration_account_id: 'co1', period: '2026-05', account_code: 'Council Tax', dental_bucket: 'overhead', amount_pence: 140600, source: 'quickbooks', accounting_method: 'accrual' },
      { integration_account_id: 'co1', period: '2026-05', account_code: 'Advertising/Promotional', dental_bucket: 'overhead', amount_pence: 309600, source: 'quickbooks', accounting_method: 'accrual' },
    ];
    stub(qbo);
    const r = await svc.plMargin(ORG, { scope: 'all', period: 'month', periodKey: '2026-05', source: 'quickbooks', now });
    expect(r.breakdown.revPence).toEqual([
      { name: 'Sales', amountPence: 23978126 },
      { name: 'Patient Refund', amountPence: -35000 },
    ]);
    expect(r.breakdown.labMaterialsPence).toEqual([
      { name: 'Lab fees', amountPence: 1761900 },
      { name: 'Dental Materials', amountPence: 452925 },
    ]);
    // associate pay sorts above salaries; both on the staff line.
    expect(r.breakdown.staffPence).toEqual([
      { name: 'Associate Salary', amountPence: 9446497 },
      { name: 'Salaries', amountPence: 1988388 },
    ]);
    expect(r.breakdown.otherOpexPence).toEqual([
      { name: 'Advertising/Promotional', amountPence: 309600 },
      { name: 'Council Tax', amountPence: 140600 },
    ]);
    // Detail sums reconcile to the summary line totals.
    const sum = (a) => a.reduce((t, x) => t + x.amountPence, 0);
    expect(sum(r.breakdown.staffPence)).toBe(r.statement.staffPence);
    expect(sum(r.breakdown.labMaterialsPence)).toBe(r.statement.labMaterialsPence);
  });

  it('breakdown respects synced-overrides-manual: manual lines dropped when synced exists for that bucket', async () => {
    const mixed = [
      { practice_id: 'p1', period: '2026-05', account_code: 'Council Tax', dental_bucket: 'overhead', amount_pence: 140600, source: 'xero' },
      { practice_id: 'p1', period: '2026-05', account_code: 'Manual overhead guess', dental_bucket: 'overhead', amount_pence: 999999, source: 'manual' },
      { practice_id: 'p1', period: '2026-05', dental_bucket: 'revenue', amount_pence: 5000000, source: 'xero' },
    ];
    stub(mixed);
    const r = await svc.plMargin(ORG, { scope: 'all', period: 'month', periodKey: '2026-05', now });
    expect(r.breakdown.otherOpexPence).toEqual([{ name: 'Council Tax', amountPence: 140600 }]);
  });

  it('falls back to trailing annual when the selected month has no actuals', async () => {
    // Data only in March; ask for May.
    const finMar = FIN_MAY.map((r) => ({ ...r, period: '2026-03' }));
    stub(finMar);
    const r = await svc.plMargin(ORG, { scope: 'all', period: 'month', periodKey: '2026-05', now });
    expect(r.hasData).toBe(true);
    expect(r.basis).toBe('actuals-annual');
    expect(r.statement.revPence).toBe(1500000);
  });

  it('org-level rows (null practice_id) → group statement, no per-entity', async () => {
    const orgLevel = [
      { practice_id: null, period: '2026-05', dental_bucket: 'revenue', amount_pence: 800000, source: 'xero' },
      { practice_id: null, period: '2026-05', dental_bucket: 'staff', amount_pence: 250000, source: 'xero' },
    ];
    stub(orgLevel);
    const r = await svc.plMargin(ORG, { scope: 'all', period: 'month', periodKey: '2026-05', now });
    expect(r.hasData).toBe(true);
    expect(r.statement.revPence).toBe(800000);
    expect(r.perEntityAvailable).toBe(false);
    expect(r.entities).toEqual([]);
  });

  it('a BST month window resolves to that single London month, not the prior month', async () => {
    // Regression: the frontend sends London-local-midnight UTC instants. During
    // BST, 1 Jun London = 2026-05-31T23:00Z and 1 Jul London = 2026-06-30T23:00Z.
    // Reading getUTCMonth() off the `since` leaked May into a June request, summing
    // May+June and mislabelling the result "Trailing 12mo". The window must cover
    // June ALONE → basis actuals-month, June figures only.
    const fin = [
      { practice_id: 'p1', period: '2026-05', dental_bucket: 'revenue', amount_pence: 1000000, source: 'xero' },
      { practice_id: 'p1', period: '2026-06', dental_bucket: 'revenue', amount_pence: 300000, source: 'xero' },
      { practice_id: 'p1', period: '2026-06', dental_bucket: 'staff', amount_pence: 100000, source: 'xero' },
    ];
    stub(fin);
    const r = await svc.plMargin(ORG, {
      scope: 'all', period: 'month',
      since: '2026-05-31T23:00:00.000Z', // London 2026-06-01 00:00 (BST)
      until: '2026-06-30T23:00:00.000Z', // London 2026-07-01 00:00 (exclusive)
      now,
    });
    expect(r.basis).toBe('actuals-month');
    expect(r.statement.revPence).toBe(300000); // June only — NOT 1,300,000
    expect(r.statement.staffPence).toBe(100000);
    expect(r.statement.netPence).toBe(200000);
  });

  it('no actuals → honest empty state (hasData false, basis none)', async () => {
    stub([]);
    const r = await svc.plMargin(ORG, { scope: 'all', period: 'month', periodKey: '2026-05', now });
    expect(r.hasData).toBe(false);
    expect(r.basis).toBe('none');
    expect(r.costsAvailable).toBe(false);
    expect(r.entities).toEqual([]);
  });
});

// ----------------------------------------------------------------------------
// QuickBooks path: company-level P&L (no practice tag), accrual/cash basis, and
// the associates bucket folded into staff & clinician pay. monthly_financials
// QBO rows carry integration_account_id (the QB company) but practice_id = null,
// so the per-entity split is BY COMPANY, labelled from integration_accounts.
// ----------------------------------------------------------------------------
describe('plMargin — QuickBooks (company split, accrual/cash, associates)', () => {
  const QBO_ACCOUNTS = [
    { id: 'ia1', label: 'Co One', status: 'active', config: { company_name: 'Company One Ltd' } },
    { id: 'ia2', label: 'Co Two', status: 'active', config: { company_name: 'Company Two Ltd' } },
  ];
  function stubQbo(fin) {
    supaRec.resultProvider = (q) => {
      if (q.table === 'practices') return { data: ENTITIES, error: null };
      if (q.table === 'integration_accounts') return { data: QBO_ACCOUNTS, error: null };
      if (q.table === 'monthly_financials') return { data: fin, error: null };
      return { data: [], error: null };
    };
  }

  it('folds the associates bucket into staff & clinician pay', async () => {
    const fin = [
      { practice_id: null, integration_account_id: 'ia1', period: '2026-05', dental_bucket: 'revenue', amount_pence: 1000000, source: 'quickbooks', accounting_method: 'accrual' },
      { practice_id: null, integration_account_id: 'ia1', period: '2026-05', dental_bucket: 'staff', amount_pence: 200000, source: 'quickbooks', accounting_method: 'accrual' },
      { practice_id: null, integration_account_id: 'ia1', period: '2026-05', dental_bucket: 'associates', amount_pence: 300000, source: 'quickbooks', accounting_method: 'accrual' },
    ];
    stubQbo(fin);
    const r = await svc.plMargin(ORG, { scope: 'all', period: 'month', periodKey: '2026-05', source: 'quickbooks', accountingMethod: 'accrual', now });
    expect(r.statement.staffPence).toBe(500000); // 200k staff + 300k associates
    expect(r.statement.netPence).toBe(500000); // 1,000,000 rev - 500,000 staff
    expect(r.statement.marginPct).toBe(50);
  });

  it('splits per-entity by QuickBooks company, labelled from integration_accounts', async () => {
    const fin = [
      { practice_id: null, integration_account_id: 'ia1', period: '2026-05', dental_bucket: 'revenue', amount_pence: 1000000, source: 'quickbooks', accounting_method: 'accrual' },
      { practice_id: null, integration_account_id: 'ia2', period: '2026-05', dental_bucket: 'revenue', amount_pence: 400000, source: 'quickbooks', accounting_method: 'accrual' },
    ];
    stubQbo(fin);
    const r = await svc.plMargin(ORG, { scope: 'all', period: 'month', periodKey: '2026-05', source: 'quickbooks', accountingMethod: 'accrual', now });
    expect(r.perEntityAvailable).toBe(true);
    expect(r.entities.map((e) => e.name)).toEqual(['Company One Ltd', 'Company Two Ltd']);
    expect(r.entities.every((e) => e.kind === 'company')).toBe(true);
    expect(r.entities[0].revPence).toBe(1000000);
    // Group statement = sum across companies.
    expect(r.statement.revPence).toBe(1400000);
  });

  it('cash basis surfaces only cash rows (no accrual double-count)', async () => {
    const fin = [
      { practice_id: null, integration_account_id: 'ia1', period: '2026-05', dental_bucket: 'revenue', amount_pence: 1000000, source: 'quickbooks', accounting_method: 'accrual' },
      { practice_id: null, integration_account_id: 'ia1', period: '2026-05', dental_bucket: 'revenue', amount_pence: 900000, source: 'quickbooks', accounting_method: 'cash' },
    ];
    stubQbo(fin);
    const accrual = await svc.plMargin(ORG, { scope: 'all', period: 'month', periodKey: '2026-05', source: 'quickbooks', accountingMethod: 'accrual', now });
    expect(accrual.statement.revPence).toBe(1000000);
    const cash = await svc.plMargin(ORG, { scope: 'all', period: 'month', periodKey: '2026-05', source: 'quickbooks', accountingMethod: 'cash', now });
    expect(cash.statement.revPence).toBe(900000);
  });
});
