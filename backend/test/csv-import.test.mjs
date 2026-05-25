// CSV manual feed — parse/validate/stage with row-level rejects, and the
// dual-approval gate (uploader != approver) + idempotent live upsert.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/repositories/csv-import.repository.js', () => ({
    csvImportRepository: {
        loadSiteMap: vi.fn(),
        loadContactMap: vi.fn(),
        createBatch: vi.fn(),
        insertRows: vi.fn(),
        getBatch: vi.fn(),
        getRows: vi.fn(),
        approveBatch: vi.fn(),
        rejectBatch: vi.fn(),
    },
}));

const svc = await import('../src/services/csv-import.service.js');
const { csvImportRepository: repo } = await import('../src/repositories/csv-import.repository.js');

beforeEach(() => {
    vi.clearAllMocks();
    repo.loadSiteMap.mockResolvedValue(new Map([['ASHFORD', 'prac-1']]));
    repo.loadContactMap.mockResolvedValue(new Map([['PAT-1', 'cont-1']]));
    repo.createBatch.mockImplementation(async (orgId, userId, dataset, filename, counts) => ({
        id: 'batch-1', dataset, status: 'pending', uploaded_by: userId, ...counts,
    }));
    repo.insertRows.mockResolvedValue(undefined);
});

const PAYMENTS_CSV = [
    'payment_id,practice_code,patient_external_id,payment_date,amount,payment_method,allocated_status',
    'PAY1,ASHFORD,PAT-1,2026-05-01,12.50,card,allocated',   // valid
    'PAY2,NOPE,PAT-1,2026-05-01,5.00,cash,allocated',        // unknown practice -> reject
    'PAY3,ASHFORD,,2026-05-01,abc,card,allocated',           // bad amount -> reject
].join('\n');

describe('parseAndStage', () => {
    it('validates per row, stages, and reports row-level rejects', async () => {
        const { batch, rejected } = await svc.parseAndStage('org-1', 'u1', 'payments', 'pay.csv', PAYMENTS_CSV);
        expect(batch.row_count).toBe(3);
        expect(batch.valid_count).toBe(1);
        expect(batch.rejected_count).toBe(2);
        expect(rejected.map((r) => r.row_number).sort()).toEqual([3, 4]);
        expect(rejected.find((r) => r.row_number === 3).error).toMatch(/unknown practice_code/);
        expect(rejected.find((r) => r.row_number === 4).error).toMatch(/amount must be a number/);

        // staged rows carry the mapped live row for the valid one (pence + practice)
        const staged = repo.insertRows.mock.calls[0][0];
        const validRow = staged.find((r) => r.valid);
        expect(validRow.raw.mapped).toMatchObject({
            source: 'manual', external_id: 'PAY1', practice_id: 'prac-1', amount_pence: 1250, contact_id: 'cont-1',
        });
    });

    it('throws ApprovalError on unparseable input', async () => {
        repo.createBatch.mockClear();
        // A bare quote makes csv-parse throw.
        await expect(svc.parseAndStage('org-1', 'u1', 'payments', 'x.csv', 'a,b\n"unterminated,2'))
            .rejects.toThrow(svc.ApprovalError);
    });
});

describe('approveBatch (dual control)', () => {
    it('rejects the uploader approving their own import (403-class)', async () => {
        repo.getBatch.mockResolvedValue({ id: 'batch-1', dataset: 'payments', status: 'pending', uploaded_by: 'u1' });
        await expect(svc.approveBatch('org-1', 'u1', 'batch-1')).rejects.toThrow(/different user must approve/);
        expect(repo.approveBatch).not.toHaveBeenCalled();
    });

    it('lets a different user approve and upserts only valid mapped rows', async () => {
        repo.getBatch.mockResolvedValue({ id: 'batch-1', dataset: 'payments', status: 'pending', uploaded_by: 'u1' });
        repo.getRows.mockResolvedValue([
            { valid: true, raw: { mapped: { source: 'manual', external_id: 'PAY1', practice_id: 'prac-1', amount_pence: 1250 } } },
            { valid: false, raw: { original: {} } },
        ]);
        const res = await svc.approveBatch('org-1', 'u2', 'batch-1');
        expect(res.imported).toBe(1);
        const [, batchId, approverId, table, onConflict, liveRows] = repo.approveBatch.mock.calls[0];
        expect(table).toBe('payments');
        expect(onConflict).toBe('organisation_id,source,external_id');
        expect(liveRows).toHaveLength(1);
        expect(approverId).toBe('u2');
    });

    it('refuses to approve a non-pending batch', async () => {
        repo.getBatch.mockResolvedValue({ id: 'batch-1', dataset: 'payments', status: 'approved', uploaded_by: 'u1' });
        await expect(svc.approveBatch('org-1', 'u2', 'batch-1')).rejects.toThrow(/already approved/);
    });
});
