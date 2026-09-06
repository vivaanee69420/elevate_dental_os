import * as lead_service_1 from "../services/lead.service.js";
import * as lead_model_1 from "../models/lead.model.js";
import { idParamSchema } from "../models/common.model.js";
export const leadController = {
    async list(req, res) {
        const q = lead_model_1.leadListQuerySchema.parse(req.query);
        const leads = await lead_service_1.leadService.list(req.user.organisation_id, q);
        res.json({ leads });
    },
    // Streams every matching lead as CSV. Headers are only set on the FIRST
    // write, so a validation/service error raised before any row is written
    // still answers a JSON status via errorHandler rather than a headers-sent
    // exception — same idiom as the Data Room's exportCsv.
    async exportCsv(req, res) {
        const q = lead_model_1.leadExportQuerySchema.parse(req.query);
        let started = false;
        const sink = {
            write(chunk) {
                if (!started) {
                    started = true;
                    res.status(200);
                    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
                    res.setHeader('Content-Disposition', `attachment; filename="${lead_service_1.leadService.exportFilename(q)}"`);
                    res.setHeader('Cache-Control', 'no-store');
                }
                res.write(chunk);
            },
            end() { res.end(); },
        };
        try {
            await lead_service_1.leadService.streamExportCsv(req.user.organisation_id, q, sink);
        }
        catch (err) {
            if (!started)
                throw err; // JSON error via errorHandler
            req.log?.error({ err }, 'Lead export failed mid-stream');
            res.end();
        }
    },
    async funnel(req, res) {
        const q = lead_model_1.leadFunnelQuerySchema.parse(req.query);
        res.json(await lead_service_1.leadService.funnel(req.user.organisation_id, {
            since: q.since ?? null,
            until: q.until ?? null,
            practiceId: q.practice_id ?? null,
        }));
    },
    async report(req, res) {
        const q = lead_model_1.leadReportQuerySchema.parse(req.query);
        res.json(await lead_service_1.leadService.report(req.user.organisation_id, {
            since: q.since ?? null,
            until: q.until ?? null,
            practiceId: q.practice_id ?? null,
            accountId: q.integration_account_id ?? null,
        }));
    },
    async pipelines(req, res) {
        const q = lead_model_1.pipelinesQuerySchema.parse(req.query);
        res.json(await lead_service_1.leadService.pipelines(req.user.organisation_id, q));
    },
    async getById(req, res) {
        const { id } = idParamSchema.parse(req.params);
        const data = await lead_service_1.leadService.getById(req.user.organisation_id, id);
        res.json(data);
    },
    async create(req, res) {
        const body = lead_model_1.leadCreateSchema.parse(req.body);
        res.json(await lead_service_1.leadService.create(req.user.organisation_id, body));
    },
    async update(req, res) {
        const body = lead_model_1.leadUpdateSchema.parse(req.body);
        res.json(await lead_service_1.leadService.update(req.user.organisation_id, req.params.id, body));
    },
    async remove(req, res) {
        const { id } = idParamSchema.parse(req.params);
        res.json(await lead_service_1.leadService.softDelete(req.user.organisation_id, id));
    },
};
