// QuickBooks sync — P&L report parsing (Rows.Row / ColData shape),
// account->bucket mapping, pence conversion, and syncOneOrg delete-then-insert
// into monthly_financials keyed by source='quickbooks'.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supaRec } from './setup.js';
import { encryptSecret } from '../src/lib/crypto.js';

vi.mock('../src/repositories/integration.repository.js', () => ({
    integrationRepository: { upsert: vi.fn(), markFailed: vi.fn(), getByProvider: vi.fn() },
}));

const { syncOneOrg, __test } = await import('../src/lib/integrations/quickbooks-sync.js');
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
        expect(__test.heuristicBucket('Associate Wages', 'Expenses')).toBe('staff');
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

        const integration = {
            secrets: encryptSecret(JSON.stringify({ access_token: 'tok', refresh_token: 'r' })),
            config: { realm_id: 'realm-1' },
            expires_at: new Date(Date.now() + 3600_000).toISOString(), // fresh -> no refresh
        };
        const res = await syncOneOrg('org-1', integration);

        expect(res.lines).toBe(2);
        const del = queries.find((q) => q.table === 'monthly_financials' && q.op === 'delete');
        expect(del.eqs).toEqual(expect.arrayContaining([
            { col: 'organisation_id', val: 'org-1' }, { col: 'source', val: 'quickbooks' },
        ]));
        const ins = queries.find((q) => q.table === 'monthly_financials' && q.op === 'insert');
        expect(ins.insertVals).toEqual(expect.arrayContaining([
            expect.objectContaining({ account_code: 'Patient Fees', dental_bucket: 'revenue', amount_pence: 1000000, source: 'quickbooks' }),
            expect.objectContaining({ account_code: 'Lab Fees', dental_bucket: 'lab', amount_pence: 120000 }),
        ]));
        expect(integrationRepository.upsert).toHaveBeenCalled();
    });

    it('marks failed when no company (realmId) is connected', async () => {
        const integration = {
            secrets: encryptSecret(JSON.stringify({ access_token: 'tok' })),
            config: {}, expires_at: new Date(Date.now() + 3600_000).toISOString(),
        };
        await expect(syncOneOrg('org-1', integration)).rejects.toThrow(/realmId|company/);
        expect(integrationRepository.markFailed).toHaveBeenCalled();
    });
});
