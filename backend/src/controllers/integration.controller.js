import * as integration_service_1 from "../services/integration.service.js";
import * as integration_model_1 from "../models/integration.model.js";
export const integrationController = {
    async list(req, res) {
        res.json(await integration_service_1.integrationService.list(req.user.organisation_id));
    },
    async connect(req, res) {
        const body = integration_model_1.integrationConnectSchema.parse(req.body);
        res.json(integration_service_1.integrationService.connect(req.user.organisation_id, body));
    },
    async remove(req, res) {
        res.json(await integration_service_1.integrationService.remove(req.user.organisation_id, req.params.id));
    },
};
