import * as pay_run_service_1 from "../services/pay-run.service.js";
import * as pay_run_model_1 from "../models/pay-run.model.js";
export const payRunController = {
    async list(req, res) {
        res.json(await pay_run_service_1.payRunService.list(req.user.organisation_id));
    },
    async calculate(req, res) {
        const body = pay_run_model_1.payRunCalculateSchema.parse(req.body);
        res.json(await pay_run_service_1.payRunService.calculate(req.user.organisation_id, body));
    },
    async approve(req, res) {
        res.json(await pay_run_service_1.payRunService.approve(req.user.organisation_id, req.params.id, req.user.id));
    },
};
