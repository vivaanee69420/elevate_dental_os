import * as billing_service_1 from "../services/billing.service.js";
export const billingController = {
    async portal(req, res) {
        res.json(await billing_service_1.billingService.portal(req.user.organisation_id, req.user.email));
    },
};
