// CSV import service — parse, validate per row, stage, and (on dual approval)
// upsert into live tables. Direct-validated-upsert with a staging + approval
// gate: rows land in csv_import_rows, a DIFFERENT user approves, then valid
// rows upsert idempotently (source='manual', composite key) into the live table.
//
//   parseAndStage(orgId, userId, dataset, filename, content)
//     -> { batch, rejected: [{row_number, error}] }
//   approveBatch(orgId, approverId, batchId)   (throws ApprovalError on uploader==approver)
//   rejectBatch / listBatches / getBatchDetail
//
// Mapping mirrors dentally-sync so manual + API feeds produce identical rows.

import { parse } from "csv-parse/sync";
import { ROW_SCHEMA, TARGET } from "../models/csv-import.model.js";
import { csvImportRepository } from "../repositories/csv-import.repository.js";

export class ApprovalError extends Error {
    constructor(message) { super(message); this.name = 'ApprovalError'; }
}

const allowedMethods = ['card', 'apple_pay', 'google_pay', 'bank_transfer', 'cash', 'direct_debit', 'finance', 'card_on_file', 'pay_link'];

function mapPaymentMethod(m) {
    const v = String(m || '').toLowerCase();
    return allowedMethods.includes(v) ? v : null;
}
function mapPaymentStatus(s) {
    switch (String(s || '').toLowerCase()) {
        case 'allocated': case 'settled': case 'paid': return 'settled';
        case 'failed': case 'declined': return 'failed';
        case 'refunded': return 'refunded';
        default: return 'pending';
    }
}
function mapApptStatus(s) {
    const v = String(s || '').toLowerCase();
    return ['scheduled', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show'].includes(v) ? v : 'scheduled';
}
function toPence(amount) {
    const n = Number(amount);
    return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

// Build the live-table row for a validated CSV row, or throw with a row-level reason.
function mapRow(dataset, row, orgId, siteMap, contactMap) {
    if (dataset === 'payments') {
        const practiceId = siteMap.get(String(row.practice_code));
        if (!practiceId) throw new Error(`unknown practice_code '${row.practice_code}'`);
        return {
            organisation_id: orgId, source: 'manual', external_id: String(row.payment_id),
            practice_id: practiceId,
            contact_id: row.patient_external_id ? (contactMap.get(String(row.patient_external_id)) ?? null) : null,
            amount_pence: toPence(row.amount),
            method: mapPaymentMethod(row.payment_method),
            status: mapPaymentStatus(row.allocated_status),
            processed_at: row.payment_date,
        };
    }
    if (dataset === 'patients') {
        return {
            organisation_id: orgId, source: 'manual', pms_external_id: String(row.patient_external_id),
            type: 'patient',
            first_name: row.first_name || null, last_name: row.last_name || null,
            email: row.email || null, phone: row.phone || null,
            date_of_birth: row.date_of_birth || null,
            practice_id: row.practice_code ? (siteMap.get(String(row.practice_code)) ?? null) : null,
        };
    }
    // appointments
    const practiceId = siteMap.get(String(row.practice_code));
    if (!practiceId) throw new Error(`unknown practice_code '${row.practice_code}'`);
    return {
        organisation_id: orgId, source: 'manual', pms_external_id: String(row.appointment_external_id),
        practice_id: practiceId,
        contact_id: row.patient_external_id ? (contactMap.get(String(row.patient_external_id)) ?? null) : null,
        starts_at: row.starts_at, ends_at: row.ends_at,
        status: mapApptStatus(row.status),
    };
}

export async function parseAndStage(orgId, userId, dataset, filename, content) {
    const schema = ROW_SCHEMA[dataset];
    let records;
    try {
        records = parse(content, { columns: true, skip_empty_lines: true, trim: true, bom: true });
    } catch (err) {
        throw new ApprovalError(`CSV parse failed: ${err.message}`);
    }

    const siteMap = await csvImportRepository.loadSiteMap(orgId);
    const contactMap = await csvImportRepository.loadContactMap(orgId);

    const stagedRows = [];
    const rejected = [];
    let valid = 0;
    records.forEach((raw, i) => {
        const rowNumber = i + 2; // +1 for 0-index, +1 for header line
        const parsed = schema.safeParse(raw);
        if (!parsed.success) {
            const reason = parsed.error.issues.map((x) => x.message).join('; ');
            stagedRows.push({ row_number: rowNumber, raw: { original: raw }, valid: false, error: reason });
            rejected.push({ row_number: rowNumber, error: reason });
            return;
        }
        try {
            const mapped = mapRow(dataset, parsed.data, orgId, siteMap, contactMap);
            stagedRows.push({ row_number: rowNumber, raw: { original: raw, mapped }, valid: true, error: null });
            valid++;
        } catch (err) {
            stagedRows.push({ row_number: rowNumber, raw: { original: raw }, valid: false, error: err.message });
            rejected.push({ row_number: rowNumber, error: err.message });
        }
    });

    const batch = await csvImportRepository.createBatch(orgId, userId, dataset, filename, {
        row_count: records.length,
        valid_count: valid,
        rejected_count: rejected.length,
    });
    await csvImportRepository.insertRows(stagedRows.map((r) => ({ ...r, batch_id: batch.id, organisation_id: orgId })));
    return { batch, rejected };
}

export async function approveBatch(orgId, approverId, batchId) {
    const batch = await csvImportRepository.getBatch(orgId, batchId);
    if (!batch) throw new ApprovalError('batch not found');
    if (batch.status !== 'pending') throw new ApprovalError(`batch already ${batch.status}`);
    // Dual control: the uploader cannot approve their own import.
    if (batch.uploaded_by && String(batch.uploaded_by) === String(approverId)) {
        throw new ApprovalError('a different user must approve this import');
    }
    const rows = await csvImportRepository.getRows(orgId, batchId);
    const liveRows = rows.filter((r) => r.valid && r.raw?.mapped).map((r) => r.raw.mapped);
    const { table, onConflict } = TARGET[batch.dataset];
    await csvImportRepository.approveBatch(orgId, batchId, approverId, table, onConflict, liveRows);
    return { imported: liveRows.length, dataset: batch.dataset };
}

export async function rejectBatch(orgId, batchId, reason) {
    const batch = await csvImportRepository.getBatch(orgId, batchId);
    if (!batch) throw new ApprovalError('batch not found');
    await csvImportRepository.rejectBatch(orgId, batchId, reason);
    return { rejected: true };
}

export async function listBatches(orgId) {
    return csvImportRepository.listBatches(orgId);
}

export async function getBatchDetail(orgId, batchId) {
    const batch = await csvImportRepository.getBatch(orgId, batchId);
    if (!batch) return null;
    const rows = await csvImportRepository.getRows(orgId, batchId);
    return { batch, rows };
}
