import * as lead_service_1 from "../services/lead.service.js";
import * as lead_model_1 from "../models/lead.model.js";
import { idParamSchema } from "../models/common.model.js";
export const leadController = {
    async list(req, res) {
        const q = lead_model_1.leadListQuerySchema.parse(req.query);
        const leads = await lead_service_1.leadService.list(req.user.organisation_id, q);
        res.json({ leads });
    },
    async funnel(req, res) {
        res.json(await lead_service_1.leadService.funnel(req.user.organisation_id));
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
