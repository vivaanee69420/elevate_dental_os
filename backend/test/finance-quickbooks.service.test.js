import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/repositories/quickbooks-finance.repository.js', () => ({
  quickbooksFinanceRepository: {
    pnlRows: vi.fn(),
    bankRows: vi.fn(),
    bankSnapshotRows: vi.fn(),
    receivableRows: vi.fn(),
    receiptRows: vi.fn(),
    accounts: vi.fn(),
  },
}));

const { financeQuickbooksService } = await import('../src/services/finance-quickbooks.service.js');
const { quickbooksFinanceRepository: repo } = await import('../src/repositories/quickbooks-finance.repository.js');

describe('financeQuickbooksService.getOverview', () => {
  beforeEach(() => {
    repo.pnlRows.mockReset();
    repo.bankRows.mockReset();
    repo.receivableRows.mockReset();
    repo.receiptRows.mockReset();
    repo.accounts.mockReset();
    // Cash is read as a month-end snapshot, falling back to the live
    // bank_accounts rows when no history exists for that period. Default to no
    // history so these cases exercise the fallback.
    repo.bankSnapshotRows.mockReset();
    repo.bankSnapshotRows.mockResolvedValue([]);
  });

  it('sums revenue/expenses/net and computes margin (summed view, per-company breakdown)', async () => {
    repo.pnlRows.mockResolvedValue([
      { period: '2026-05', dental_bucket: 'revenue', amount_pence: 1000000, integration_account_id: 'A' },
      { period: '2026-05', dental_bucket: 'staff', amount_pence: 400000, integration_account_id: 'A' },
      { period: '2026-05', dental_bucket: 'revenue', amount_pence: 500000, integration_account_id: 'B' },
      { period: '2026-05', dental_bucket: 'lab', amount_pence: 100000, integration_account_id: 'B' },
    ]);
    repo.bankRows.mockResolvedValue([
      { balance_pence: 250000, integration_account_id: 'A' },
      { balance_pence: 50000, integration_account_id: 'B' },
    ]);
    repo.receivableRows.mockResolvedValue([{ amount_outstanding_pence: 30000, paid: false, integration_account_id: 'A' }]);
    repo.receiptRows.mockResolvedValue([{ amount_pence: 70000, integration_account_id: 'B' }]);
    repo.accounts.mockResolvedValue([
      { id: 'A', label: 'Acme', status: 'active', config: { company_name: 'Acme Dental' } },
      { id: 'B', label: 'Beta', status: 'active', config: { company_name: 'Beta Dental' } },
    ]);

    const out = await financeQuickbooksService.getOverview('org-1', { period: '2026-05' });

    expect(out.summary.revenuePence).toBe(1500000);
    expect(out.summary.expensesPence).toBe(500000); // 400000 staff + 100000 lab
    expect(out.summary.netProfitPence).toBe(1000000);
    expect(out.summary.netMarginPct).toBeCloseTo(66.7, 1);
    expect(out.summary.cashAtBankPence).toBe(300000);
    expect(out.summary.receivablesPence).toBe(30000);
    expect(out.summary.receiptsPence).toBe(70000);

    // per-company present in summed view, sorted by revenue desc
    expect(out.companies.map((c) => c.accountId)).toEqual(['A', 'B']);
    expect(out.companies[0]).toMatchObject({ companyName: 'Acme Dental', revenuePence: 1000000, cashAtBankPence: 250000 });
    expect(out.companies[1]).toMatchObject({ companyName: 'Beta Dental', revenuePence: 500000, receiptsPence: 70000 });
    expect(out.accounts).toHaveLength(2);
  });

  it('omits the per-company breakdown when scoped to one account', async () => {
    repo.pnlRows.mockResolvedValue([
      { period: '2026-05', dental_bucket: 'revenue', amount_pence: 800000, integration_account_id: 'A' },
    ]);
    repo.bankRows.mockResolvedValue([]);
    repo.receivableRows.mockResolvedValue([]);
    repo.receiptRows.mockResolvedValue([]);
    repo.accounts.mockResolvedValue([{ id: 'A', label: 'Acme', status: 'active', config: {} }]);

    const out = await financeQuickbooksService.getOverview('org-1', { accountId: 'A', period: '2026-05' });
    expect(out.summary.revenuePence).toBe(800000);
    expect(out.companies).toEqual([]);
    // accountId scope is forwarded to every repo read
    expect(repo.pnlRows).toHaveBeenCalledWith('org-1', expect.objectContaining({ accountId: 'A' }));
    expect(repo.bankRows).toHaveBeenCalledWith('org-1', expect.objectContaining({ accountId: 'A' }));
  });

  it('defaults to a trailing 12-month window when no period/range given', async () => {
    repo.pnlRows.mockResolvedValue([]);
    repo.bankRows.mockResolvedValue([]);
    repo.receivableRows.mockResolvedValue([]);
    repo.receiptRows.mockResolvedValue([]);
    repo.accounts.mockResolvedValue([]);
    const out = await financeQuickbooksService.getOverview('org-1', {});
    expect(out.trend).toHaveLength(12);
  });
});

// ============================================================================
// Rows whose integration_account_id is null. On the live database ten such rows
// carry £14,797.57 of revenue — real money, counted in the group total, but the
// per-company breakdown labelled them "QuickBooks", which reads as the name of a
// fifth connected company rather than as the residue it is.
// ============================================================================
describe('financeQuickbooksService — rows not attached to a connected company', () => {
  beforeEach(() => {
    repo.bankRows.mockResolvedValue([]);
    repo.bankSnapshotRows.mockResolvedValue([]);
    repo.receivableRows.mockResolvedValue([]);
    repo.receiptRows.mockResolvedValue([]);
    repo.accounts.mockResolvedValue([
      { id: 'A', label: 'Acme', status: 'active', config: { company_name: 'Acme Dental' } },
    ]);
  });

  it('names the residue row for what it is, not after a company that does not exist', async () => {
    repo.pnlRows.mockResolvedValue([
      { period: '2026-05', dental_bucket: 'revenue', amount_pence: 900000, integration_account_id: 'A' },
      { period: '2026-05', dental_bucket: 'revenue', amount_pence: 100000, integration_account_id: null },
    ]);

    const out = await financeQuickbooksService.getOverview('org-1', { period: '2026-05' });

    // Still counted in the group total — it is real money.
    expect(out.summary.revenuePence).toBe(1000000);
    const residue = out.companies.find((c) => c.accountId === 'unknown');
    expect(residue.companyName).toBe('Unassigned');
    expect(residue.revenuePence).toBe(100000);
    // And the breakdown must add up to the headline, or the table is a claim
    // the cards above it do not support.
    expect(out.companies.reduce((n, c) => n + c.revenuePence, 0)).toBe(out.summary.revenuePence);
  });
});
