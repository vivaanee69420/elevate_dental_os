"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.integrationController = void 0;
const integration_service_1 = require("../services/integration.service");
const integration_model_1 = require("../models/integration.model");
exports.integrationController = {
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
