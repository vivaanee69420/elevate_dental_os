// ============================================================================
// QuickBooks finance reads page past PostgREST's row ceiling.
//
// Measured on the live database (GM Dental Group, four connected companies):
// the DEFAULT view of this dashboard — trailing twelve months, all companies,
// accrual — needs 1,214 monthly_financials rows and the server hands back
// exactly 1,000. Revenue read £4,669,274.15 against a true £5,282,486.91, and
// net profit read HIGHER than the truth (£866,928.79 vs £841,724.43) because
// the rows that fell off the end were net-negative. Which rows survived was
// arbitrary too: the read carried no ORDER BY.
//
// The row TOTAL cannot catch this here — the harness slices by .range() exactly
// as the server does, so a correct pager and one that stops on a short page
// both return every row. Only the READ COUNT separates them.
// ============================================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const repo = (await import('../src/repositories/quickbooks-finance.repository.js'))
  .quickbooksFinanceRepository;

const ORG_A = 'org-aaaaaaaa';
const ORG_B = 'org-bbbbbbbb';
const orgFilter = (q) => q.eqs.find((e) => e.col === 'organisation_id');

let reads = 0;
const serve = (rows) => {
  reads = 0;
  supaRec.resultProvider = () => { reads += 1; return { data: rows, error: null }; };
};

beforeEach(() => { supaRec.last = undefined; });

describe('quickbooksFinanceRepository.pnlRows', () => {
  const row = (i) => ({
    id: i, period: '2026-08', dental_bucket: 'overhead',
    amount_pence: 100, integration_account_id: null,
  });

  it('returns EVERY row when the window exceeds one page, not just the first 1,000', async () => {
    serve(Array.from({ length: 1214 }, (_, i) => row(i)));
    const out = await repo.pnlRows(ORG_A, { fromPeriod: '2025-10', toPeriod: '2026-09' });
    expect(out).toHaveLength(1214);
    // 1000 + 214 + a confirming empty page. A `length < PAGE` reader would stop
    // after the 214-row page (2 reads) and still return all 1,214 rows, so the
    // row count alone cannot catch that regression.
    expect(reads).toBe(3);
  });

  it('reads a confirming EMPTY page rather than stopping on a short one', async () => {
    // The server's ceiling is its own setting. Treating a short page as the
    // last reintroduces this very truncation at whatever that number happens
    // to be.
    serve(Array.from({ length: 700 }, (_, i) => row(i)));
    expect(await repo.pnlRows(ORG_A, { fromPeriod: '2026-08', toPeriod: '2026-08' })).toHaveLength(700);
    expect(reads).toBe(2);
  });

  it('orders the paged read, so OFFSET cannot repeat or skip a row', async () => {
    serve([]);
    await repo.pnlRows(ORG_A, { fromPeriod: '2026-08', toPeriod: '2026-08' });
    expect(supaRec.last.orders?.some((o) => o.col === 'id')).toBe(true);
  });

  it('still scopes every page to the organisation, source and accounting method', async () => {
    serve([row(1)]);
    await repo.pnlRows(ORG_B, { fromPeriod: '2026-08', toPeriod: '2026-08', accountingMethod: 'cash' });
    expect(orgFilter(supaRec.last).val).toBe(ORG_B);
    expect(supaRec.last.eqs.find((e) => e.col === 'source').val).toBe('quickbooks');
    expect(supaRec.last.eqs.find((e) => e.col === 'accounting_method').val).toBe('cash');
  });

  it('still scopes every page to one company when accountId is given', async () => {
    serve([row(1)]);
    await repo.pnlRows(ORG_A, { accountId: 'acc-1', fromPeriod: '2026-08', toPeriod: '2026-08' });
    expect(supaRec.last.eqs.find((e) => e.col === 'integration_account_id').val).toBe('acc-1');
  });
});

describe('quickbooksFinanceRepository.receivableRows', () => {
  const inv = (i) => ({ id: i, amount_outstanding_pence: 100, paid: false, integration_account_id: null });

  it('pages, so a group with more than a page of unpaid invoices does not understate debtors', async () => {
    serve(Array.from({ length: 1400 }, (_, i) => inv(i)));
    const out = await repo.receivableRows(ORG_A, {});
    expect(out).toHaveLength(1400);
    expect(reads).toBe(3);
    expect(supaRec.last.orders?.some((o) => o.col === 'id')).toBe(true);
  });
});

describe('quickbooksFinanceRepository.receiptRows', () => {
  const pay = (i) => ({ id: i, amount_pence: 100, processed_at: '2026-08-01T00:00:00Z', integration_account_id: null });

  it('pages, so a busy window does not understate receipts collected', async () => {
    serve(Array.from({ length: 1400 }, (_, i) => pay(i)));
    const out = await repo.receiptRows(ORG_A, {
      sinceIso: '2025-10-01T00:00:00Z', untilIso: '2026-09-30T23:59:59.999Z',
    });
    expect(out).toHaveLength(1400);
    expect(reads).toBe(3);
    expect(supaRec.last.orders?.some((o) => o.col === 'id')).toBe(true);
  });
});
