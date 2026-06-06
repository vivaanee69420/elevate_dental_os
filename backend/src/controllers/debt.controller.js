import * as debt_service_1 from "../services/debt.service.js";
import * as debt_model_1 from "../models/debt.model.js";
export const debtController = {
    async list(req, res) {
        const q = debt_model_1.debtListQuerySchema.parse(req.query);
        res.json(await debt_service_1.debtService.list(req.user.organisation_id, { practiceId: q.practice_id ?? null }));
    },
};
