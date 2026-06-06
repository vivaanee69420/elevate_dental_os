// CSV import controller — parse/validate request, call the service, shape HTTP.
// No business logic here.

import { csvUploadSchema } from "../models/csv-import.model.js";
import { idParamSchema } from "../models/common.model.js";
import * as zod_1 from "zod";
import * as csv_import_service_1 from "../services/csv-import.service.js";

const rejectBodySchema = zod_1.z.object({ reason: zod_1.z.string().trim().max(500).optional() });

function handleApprovalError(err, res) {
    if (err?.name === 'ApprovalError') {
        const status = /different user must approve/i.test(err.message) ? 403
            : /not found/i.test(err.message) ? 404
            : 422;
        res.status(status).json({ error: err.message });
        return true;
    }
    return false;
}

export const csvImportController = {
    async upload(req, res) {
        const parsed = csvUploadSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: parsed.error.issues.map((x) => x.message).join('; ') });
        }
        const { dataset, filename, content } = parsed.data;
        try {
            const { batch, rejected } = await csv_import_service_1.parseAndStage(
                req.user.organisation_id, req.user.id, dataset, filename, content,
            );
            res.status(201).json({
                batch_id: batch.id,
                dataset: batch.dataset,
                status: batch.status,
                row_count: batch.row_count,
                valid_count: batch.valid_count,
                rejected_count: batch.rejected_count,
                rejected,
            });
        } catch (err) {
            if (handleApprovalError(err, res)) return;
            throw err;
        }
    },

    async list(req, res) {
        const batches = await csv_import_service_1.listBatches(req.user.organisation_id);
        res.json({ batches });
    },

    async detail(req, res) {
        const { id } = idParamSchema.parse(req.params);
        const result = await csv_import_service_1.getBatchDetail(req.user.organisation_id, id);
        if (!result) return res.status(404).json({ error: 'batch not found' });
        res.json(result);
    },

    async approve(req, res) {
        const { id } = idParamSchema.parse(req.params);
        try {
            const result = await csv_import_service_1.approveBatch(req.user.organisation_id, req.user.id, id);
            res.json(result);
        } catch (err) {
            if (handleApprovalError(err, res)) return;
            throw err;
        }
    },

    async reject(req, res) {
        const { id } = idParamSchema.parse(req.params);
        const { reason } = rejectBodySchema.parse(req.body ?? {});
        try {
            const result = await csv_import_service_1.rejectBatch(req.user.organisation_id, id, reason);
            res.json(result);
        } catch (err) {
            if (handleApprovalError(err, res)) return;
            throw err;
        }
    },
};
