import * as membership_service_1 from "../services/membership.service.js";
import * as membership_model_1 from "../models/membership.model.js";
export const membershipController = {
    async listPlans(req, res) {
        res.json(await membership_service_1.membershipService.listPlans(req.user.organisation_id));
    },
    async list(req, res) {
        res.json(await membership_service_1.membershipService.list(req.user.organisation_id));
    },
    async create(req, res) {
        const body = membership_model_1.membershipCreateSchema.parse(req.body);
        res.json(await membership_service_1.membershipService.create(req.user.organisation_id, body));
    },
};
