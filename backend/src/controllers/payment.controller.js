"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.paymentController = void 0;
const payment_service_1 = require("../services/payment.service");
const payment_model_1 = require("../models/payment.model");
exports.paymentController = {
    async list(req, res) {
        const q = payment_model_1.paymentListQuerySchema.parse(req.query);
        res.json(await payment_service_1.paymentService.list(req.user.organisation_id, q));
    },
    async createPaymentLink(req, res) {
        const body = payment_model_1.paymentLinkCreateSchema.parse(req.body);
        res.json(await payment_service_1.paymentService.createPaymentLink(req.user.organisation_id, body));
    },
};
