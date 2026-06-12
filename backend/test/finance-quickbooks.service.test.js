import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/repositories/quickbooks-finance.repository.js', () => ({
  quickbooksFinanceRepository: {
    pnlRows: vi.fn(),
    bankRows: vi.fn(),
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
