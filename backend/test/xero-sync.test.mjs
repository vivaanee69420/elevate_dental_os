// Xero sync — P&L report parsing, account->bucket mapping, pence conversion,
// and syncOneOrg delete-then-insert into monthly_financials.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supaRec } from './setup.js';
import { encryptSecret } from '../src/lib/crypto.js';

vi.mock('../src/repositories/integration.repository.js', () => ({
    integrationRepository: { upsert: vi.fn(), markFailed: vi.fn(), getByProvider: vi.fn() },
}));

const { syncOneOrg, __test } = await import('../src/lib/integrations/xero-sync.js');
const { integrationRepository } = await import('../src/repositories/integration.repository.js');

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
        expect(__test.heuristicBucket('Associate salary', 'Less Operating Expenses')).toBe('associates');
        expect(__test.heuristicBucket('Principal salary', 'Expenses')).toBe('associates');
        expect(__test.heuristicBucket('Hygienist / Therapist', 'Expenses')).toBe('associates');
        expect(__test.heuristicBucket('Salaries', 'Less Operating Expenses')).toBe('staff');
        expect(__test.heuristicBucket('Lab Fees', 'Expenses')).toBe('lab');
        expect(__test.heuristicBucket('Consumables', 'Expenses')).toBe('materials');
        expect(__test.heuristicBucket('Rent', 'Expenses')).toBe('overhead');
        expect(__test.heuristicBucket('Mystery', '')).toBe('other');
    });
    it('per-org account map overrides the heuristic', () => {
        const map = new Map([['Rent', 'staff']]); // deliberately odd to prove override wins
        expect(__test.mapBucket('Rent', 'Expenses', map)).toBe('staff');
    });
    it('ignores an invalid mapped bucket, falls back to heuristic', () => {
        const map = new Map([['Rent', 'not_a_bucket']]);
        expect(__test.mapBucket('Rent', 'Expenses', map)).toBe('overhead');
    });
});

describe('parseReportRows', () => {
    it('walks nested sections, keeps leaf Rows, drops SummaryRows', () => {
        const report = { Reports: [{ Rows: [
            { RowType: 'Section', Title: 'Income', Rows: [
                { RowType: 'Row', Cells: [{ Value: 'Patient Fees' }, { Value: '10000.00' }] },
            ] },
            { RowType: 'Section', Title: 'Less Operating Expenses', Rows: [
                { RowType: 'Row', Cells: [{ Value: 'Wages' }, { Value: '4000.00' }] },
                { RowType: 'SummaryRow', Cells: [{ Value: 'Total Expenses' }, { Value: '4000.00' }] },
            ] },
        ] }] };
        const rows = __test.parseReportRows(report);
        expect(rows).toEqual([
            { account: 'Patient Fees', amount: '10000.00', section: 'Income' },
            { account: 'Wages', amount: '4000.00', section: 'Less Operating Expenses' },
        ]);
    });
});

describe('syncOneOrg', () => {
    beforeEach(() => {
        integrationRepository.upsert.mockReset();
        integrationRepository.markFailed.mockReset();
    });

    it('pulls P&L, maps buckets, and replaces the period in monthly_financials', async () => {
        const queries = [];
        supaRec.resultProvider = (q) => { queries.push(q); return { data: [], error: null }; };
        global.fetch = vi.fn(async () => ({
            ok: true, status: 200,
            json: async () => ({ Reports: [{ Rows: [
                { RowType: 'Section', Title: 'Income', Rows: [
                    { RowType: 'Row', Cells: [{ Value: 'Patient Fees' }, { Value: '10000.00' }] },
                ] },
                { RowType: 'Section', Title: 'Less Operating Expenses', Rows: [
                    { RowType: 'Row', Cells: [{ Value: 'Lab Fees' }, { Value: '1200.00' }] },
                ] },
            ] }] }),
        }));

        const integration = {
            secrets: encryptSecret(JSON.stringify({ access_token: 'tok', refresh_token: 'r' })),
            config: { tenant_id: 'tenant-1' },
            expires_at: new Date(Date.now() + 3600_000).toISOString(), // fresh -> no refresh
        };
        // Pin to a single month so this test exercises the bucket-mapping +
        // delete/insert mechanics, not the window size (first fill = 12 months,
        // nightly = 6 — covered by the window test below).
        const res = await syncOneOrg('org-1', integration, undefined, { months: 1 });

        expect(res.lines).toBe(2);
        const del = queries.find((q) => q.table === 'monthly_financials' && q.op === 'delete');
        expect(del.eqs).toEqual(expect.arrayContaining([
            { col: 'organisation_id', val: 'org-1' }, { col: 'source', val: 'xero' },
        ]));
        const ins = queries.find((q) => q.table === 'monthly_financials' && q.op === 'insert');
        expect(ins.insertVals).toEqual(expect.arrayContaining([
            expect.objectContaining({ account_code: 'Patient Fees', dental_bucket: 'revenue', amount_pence: 1000000, source: 'xero' }),
            expect.objectContaining({ account_code: 'Lab Fees', dental_bucket: 'lab', amount_pence: 120000 }),
        ]));
        expect(integrationRepository.upsert).toHaveBeenCalled();
    });

    it('first fill (no prior sync) pulls 12 months; nightly (already synced) pulls 6', async () => {
        const months = new Set();
        global.fetch = vi.fn(async (url) => {
            const u = new URL(url.toString());
            months.add(u.searchParams.get('fromDate').slice(0, 7)); // YYYY-MM
            return { ok: true, status: 200, json: async () => ({ Reports: [{ Rows: [] }] }) };
        });
        const base = {
            secrets: encryptSecret(JSON.stringify({ access_token: 'tok', refresh_token: 'r' })),
            config: { tenant_id: 'tenant-1' },
            expires_at: new Date(Date.now() + 3600_000).toISOString(),
        };

        months.clear();
        await syncOneOrg('org-1', { ...base, last_sync_at: null });
        expect(months.size).toBe(12); // first fill

        months.clear();
        await syncOneOrg('org-1', { ...base, last_sync_at: new Date().toISOString() });
        expect(months.size).toBe(6);  // nightly cron
    });

    it('marks failed when no tenant is connected', async () => {
        const integration = {
            secrets: encryptSecret(JSON.stringify({ access_token: 'tok' })),
            config: {}, expires_at: new Date(Date.now() + 3600_000).toISOString(),
        };
        await expect(syncOneOrg('org-1', integration)).rejects.toThrow(/tenant/);
        expect(integrationRepository.markFailed).toHaveBeenCalled();
    });
});
