// QuickBooks sync — P&L report parsing (Rows.Row / ColData shape), account->bucket
// mapping, pence conversion, and the MULTI-ACCOUNT syncAccount delete-then-insert
// into monthly_financials keyed by source='quickbooks' + integration_account_id.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supaRec } from './setup.js';
import { encryptSecret } from '../src/lib/crypto.js';

vi.mock('../src/repositories/integration-account.repository.js', () => ({
    integrationAccountRepository: {
        getByIdWithSecrets: vi.fn(),
        markSynced: vi.fn(),
        markFailed: vi.fn(),
        list: vi.fn(async () => []),
    },
}));
// refreshAccountToken is only called when the token is near expiry; stub it so
// the fresh-token path never reaches the network.
vi.mock('../src/lib/integrations/quickbooks-provider.js', () => ({
    refreshAccountToken: vi.fn(async () => ({ ok: true })),
    QuickBooksProvider: {},
}));

const { syncAccount, syncAllAccounts, __test } = await import('../src/lib/integrations/quickbooks-sync.js');
const { integrationAccountRepository } = await import('../src/repositories/integration-account.repository.js');

describe('toPence', () => {
    it('parses plain, comma-grouped, and parenthesised negatives', () => {
        expect(__test.toPence('10000.00')).toBe(1000000);
        expect(__test.toPence('1,250.50')).toBe(125050);
        expect(__test.toPence('(500.00)')).toBe(-50000);
        expect(__test.toPence('')).toBe(0);
    });
});

describe('heuristicBucket / mapBucket', () => {
    it('classifies by section + name keywords', () => {
        expect(__test.heuristicBucket('Patient Fees', 'Income')).toBe('revenue');
        expect(__test.heuristicBucket('Associate salary', 'Expenses')).toBe('associates');
        expect(__test.heuristicBucket('Principal salary', 'Expenses')).toBe('associates');
        expect(__test.heuristicBucket('Hygienist / Therapist', 'Expenses')).toBe('associates');
        expect(__test.heuristicBucket('Salaries', 'Expenses')).toBe('staff');
        expect(__test.heuristicBucket('Lab Fees', 'Cost of Goods Sold')).toBe('lab');
        expect(__test.heuristicBucket('Consumables', 'Cost of Goods Sold')).toBe('materials');
        expect(__test.heuristicBucket('Rent', 'Expenses')).toBe('overhead');
        expect(__test.heuristicBucket('Mystery', '')).toBe('other');
    });
    it('per-org account map overrides the heuristic', () => {
        const map = new Map([['Rent', 'staff']]);
        expect(__test.mapBucket('Rent', 'Expenses', map)).toBe('staff');
    });
    it('ignores an invalid mapped bucket, falls back to heuristic', () => {
        const map = new Map([['Rent', 'not_a_bucket']]);
        expect(__test.mapBucket('Rent', 'Expenses', map)).toBe('overhead');
    });
});

describe('parseReportRows', () => {
    it('walks nested sections (Header), keeps leaf ColData rows, drops Summary rows', () => {
        const report = { Rows: { Row: [
            {
                Header: { ColData: [{ value: 'Income' }, { value: '' }] },
                Rows: { Row: [
                    { ColData: [{ value: 'Patient Fees', id: '1' }, { value: '10000.00' }], type: 'Data' },
                ] },
                Summary: { ColData: [{ value: 'Total Income' }, { value: '10000.00' }] },
                type: 'Section', group: 'Income',
            },
            {
                Header: { ColData: [{ value: 'Expenses' }, { value: '' }] },
                Rows: { Row: [
                    { ColData: [{ value: 'Wages', id: '2' }, { value: '4000.00' }], type: 'Data' },
                ] },
                Summary: { ColData: [{ value: 'Total Expenses' }, { value: '4000.00' }] },
                type: 'Section', group: 'Expenses',
            },
        ] } };
        const rows = __test.parseReportRows(report);
        expect(rows).toEqual([
            { account: 'Patient Fees', amount: '10000.00', section: 'Income' },
            { account: 'Wages', amount: '4000.00', section: 'Expenses' },
        ]);
    });
});

describe('parseBalanceSheetBanks', () => {
    it('keeps only leaf accounts under a bank/cash section (or named bank/cash)', () => {
        const report = { Rows: { Row: [
            {
                Header: { ColData: [{ value: 'Bank Accounts' }] },
                Rows: { Row: [
                    { ColData: [{ value: 'Current Account' }, { value: '12500.00' }], type: 'Data' },
                    { ColData: [{ value: 'Savings' }, { value: '3000.00' }], type: 'Data' },
                ] },
                type: 'Section',
            },
            {
                Header: { ColData: [{ value: 'Accounts Receivable' }] },
                Rows: { Row: [
                    { ColData: [{ value: 'Debtors' }, { value: '900.00' }], type: 'Data' },
                ] },
                type: 'Section',
            },
        ] } };
        expect(__test.parseBalanceSheetBanks(report)).toEqual([
            { account: 'Current Account', amount: '12500.00' },
            { account: 'Savings', amount: '3000.00' },
        ]);
    });
});

describe('lastNMonths', () => {
    it('returns N descending YYYY-MM periods, newest first, with month bounds', () => {
        const months = __test.lastNMonths(12);
        expect(months).toHaveLength(12);
        expect(months[0].from).toMatch(/^\d{4}-\d{2}-01$/);
        expect(months[0].to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(months[1].period < months[0].period).toBe(true);
        expect(months[11].period < months[10].period).toBe(true);
    });
});

describe('mapInvoiceRow', () => {
    it('maps a QBO invoice to an invoices row (source=quickbooks, account-stamped, realm-prefixed external_id)', () => {
        const row = __test.mapInvoiceRow('org-1', 'acc-1', 'realm-9', 'prac-1', {
            Id: '42', TxnDate: '2026-01-10', DueDate: '2026-02-10',
            TotalAmt: '500.00', Balance: '200.00', CustomerRef: { name: 'Jane Doe' },
        });
        expect(row).toMatchObject({
            organisation_id: 'org-1', practice_id: 'prac-1', integration_account_id: 'acc-1',
            source: 'quickbooks', external_id: 'realm-9:42',
            amount_pence: 50000, amount_outstanding_pence: 20000,
            due_on: '2026-02-10', paid: false, patient_name: 'Jane Doe',
        });
    });
    it('flags paid when balance is zero', () => {
        expect(__test.mapInvoiceRow('o', 'a', 'r', 'p', { Id: '1', TotalAmt: '100', Balance: '0' }).paid).toBe(true);
    });
});

describe('dedupeReceipts', () => {
    it('drops QBO receipts matching an existing settled receipt by date+amount', () => {
        const payments = [
            { Id: '1', TxnDate: '2026-01-05', TotalAmt: '150.00' }, // dup -> dropped
            { Id: '2', TxnDate: '2026-01-06', TotalAmt: '200.00' }, // kept
        ];
        const existing = new Set(['2026-01-05|15000']);
        const { rows, deduped } = __test.dedupeReceipts('org-1', 'acc-1', 'realm-9', 'prac-1', payments, existing);
        expect(deduped).toBe(1);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            external_id: 'realm-9:2', amount_pence: 20000, status: 'settled', source: 'quickbooks',
            practice_id: 'prac-1', integration_account_id: 'acc-1', method: 'bank_transfer',
        });
        expect(rows[0].processed_at).toContain('2026-01-06');
    });
});

describe('syncAccount', () => {
    beforeEach(() => {
        integrationAccountRepository.getByIdWithSecrets.mockReset();
        integrationAccountRepository.markSynced.mockReset();
        integrationAccountRepository.markFailed.mockReset();
    });

    it('pulls P&L, maps buckets, and replaces the period scoped by integration_account_id', async () => {
        const queries = [];
        supaRec.resultProvider = (q) => { queries.push(q); return { data: [], error: null }; };
        global.fetch = vi.fn(async () => ({
            ok: true, status: 200,
            json: async () => ({ Rows: { Row: [
                {
                    Header: { ColData: [{ value: 'Income' }] },
                    Rows: { Row: [
                        { ColData: [{ value: 'Patient Fees' }, { value: '10000.00' }], type: 'Data' },
                    ] },
                    type: 'Section',
                },
                {
                    Header: { ColData: [{ value: 'Cost of Goods Sold' }] },
                    Rows: { Row: [
                        { ColData: [{ value: 'Lab Fees' }, { value: '1200.00' }], type: 'Data' },
                    ] },
                    type: 'Section',
                },
            ] } }),
        }));

        integrationAccountRepository.getByIdWithSecrets.mockResolvedValue({
            id: 'acc-1',
            secrets: encryptSecret(JSON.stringify({ access_token: 'tok', refresh_token: 'r' })),
            config: { realm_id: 'realm-1', expires_at: new Date(Date.now() + 3600_000).toISOString() },
            last_sync_at: new Date().toISOString(), // already synced -> current month only
        });

        const res = await syncAccount('org-1', 'acc-1');

        // P&L is pulled once per accounting basis (accrual + cash); the mocked
        // report returns the same 2 lines each time -> 2 bases x 2 lines = 4.
        expect(res.lines).toBe(4);
        const del = queries.find((q) => q.table === 'monthly_financials' && q.op === 'delete');
        expect(del.eqs).toEqual(expect.arrayContaining([
            { col: 'organisation_id', val: 'org-1' },
            { col: 'source', val: 'quickbooks' },
            { col: 'integration_account_id', val: 'acc-1' },
        ]));
        const ins = queries.find((q) => q.table === 'monthly_financials' && q.op === 'insert');
        expect(ins.insertVals).toEqual(expect.arrayContaining([
            expect.objectContaining({ account_code: 'Patient Fees', dental_bucket: 'revenue', amount_pence: 1000000, source: 'quickbooks', integration_account_id: 'acc-1' }),
            expect.objectContaining({ account_code: 'Lab Fees', dental_bucket: 'lab', amount_pence: 120000 }),
        ]));
        expect(integrationAccountRepository.markSynced).toHaveBeenCalledWith('org-1', 'acc-1');
    });

    it('marks the account failed when no company (realmId) is connected', async () => {
        integrationAccountRepository.getByIdWithSecrets.mockResolvedValue({
            id: 'acc-2',
            secrets: encryptSecret(JSON.stringify({ access_token: 'tok' })),
            config: { expires_at: new Date(Date.now() + 3600_000).toISOString() },
        });
        await expect(syncAccount('org-1', 'acc-2')).rejects.toThrow(/realmId|company/);
        expect(integrationAccountRepository.markFailed).toHaveBeenCalled();
    });

    it('returns no_auth without throwing when the account has no secrets', async () => {
        integrationAccountRepository.getByIdWithSecrets.mockResolvedValue({ id: 'acc-3', secrets: null });
        const res = await syncAccount('org-1', 'acc-3');
        expect(res).toEqual({ error: 'no_auth' });
    });
});

describe('syncAllAccounts', () => {
    it('isolates companies — each sync is scoped to its own integration_account_id', async () => {
        const queries = [];
        supaRec.resultProvider = (q) => { queries.push(q); return { data: [], error: null }; };
        global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ Rows: { Row: [] } }) }));
        integrationAccountRepository.list.mockResolvedValue([
            { id: 'acc-A', status: 'active' },
            { id: 'acc-B', status: 'active' },
        ]);
        integrationAccountRepository.getByIdWithSecrets.mockImplementation(async (org, id) => ({
            id,
            secrets: encryptSecret(JSON.stringify({ access_token: 'tok', refresh_token: 'r' })),
            config: { realm_id: `realm-${id}`, expires_at: new Date(Date.now() + 3600_000).toISOString() },
            last_sync_at: new Date().toISOString(),
        }));

        const res = await syncAllAccounts('org-1');
        expect(res.accounts).toBe(2);
        const deletes = queries.filter((q) => q.table === 'monthly_financials' && q.op === 'delete');
        const accountScopes = deletes.map((d) => d.eqs.find((e) => e.col === 'integration_account_id')?.val);
        expect(accountScopes).toEqual(expect.arrayContaining(['acc-A', 'acc-B']));
        // No delete ever runs without an account scope -> no cross-company wipe.
        expect(deletes.every((d) => d.eqs.some((e) => e.col === 'integration_account_id'))).toBe(true);
    });
});
