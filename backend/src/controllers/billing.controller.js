"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.billingController = void 0;
const billing_service_1 = require("../services/billing.service");
exports.billingController = {
    async portal(req, res) {
        res.json(await billing_service_1.billingService.portal(req.user.organisation_id, req.user.email));
    },
};
