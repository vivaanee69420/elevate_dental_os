// ============================================================================
// CRM template controller — parse/validate with Zod, call service, shape HTTP.
// ============================================================================
import * as crmTemplate_service_1 from "../services/crmTemplate.service.js";
import * as crmTemplate_model_1 from "../models/crmTemplate.model.js";
import { idParamSchema } from "../models/common.model.js";

export const crmTemplateController = {
    async list(req, res) {
        const query = crmTemplate_model_1.templateListQuerySchema.parse(req.query);
        res.json(await crmTemplate_service_1.crmTemplateService.list(req.user.organisation_id, query));
    },
    async create(req, res) {
        const body = crmTemplate_model_1.templateCreateSchema.parse(req.body);
        res.json(await crmTemplate_service_1.crmTemplateService.create(req.user.organisation_id, req.user.id, body));
    },
    async update(req, res) {
        const { id } = idParamSchema.parse(req.params);
        const body = crmTemplate_model_1.templateUpdateSchema.parse(req.body);
        res.json(await crmTemplate_service_1.crmTemplateService.update(req.user.organisation_id, id, body));
    },
    async remove(req, res) {
        const { id } = idParamSchema.parse(req.params);
        res.json(await crmTemplate_service_1.crmTemplateService.remove(req.user.organisation_id, id));
    },
};
