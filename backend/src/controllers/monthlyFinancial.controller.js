// ============================================================================
// Monthly financial controller — parse/validate with the Zod schemas, call the
// service, shape the HTTP response. No business logic.
// ============================================================================
import * as monthlyFinancial_service_1 from "../services/monthlyFinancial.service.js";
import * as monthlyFinancial_model_1 from "../models/monthlyFinancial.model.js";
import { idParamSchema } from "../models/common.model.js";

export const monthlyFinancialController = {
    async create(req, res) {
        const body = monthlyFinancial_model_1.monthlyFinancialCreateSchema.parse(req.body);
        const row = await monthlyFinancial_service_1.monthlyFinancialService.createManual(req.user.organisation_id, body);
        res.status(201).json(row);
    },
    async list(req, res) {
        const query = monthlyFinancial_model_1.monthlyFinancialListQuerySchema.parse(req.query);
        res.json(await monthlyFinancial_service_1.monthlyFinancialService.list(req.user.organisation_id, query));
    },
    async remove(req, res) {
        const { id } = idParamSchema.parse(req.params);
        res.json(await monthlyFinancial_service_1.monthlyFinancialService.remove(req.user.organisation_id, id));
    },
};
