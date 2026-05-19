import * as payment_service_1 from "../services/payment.service.js";
import * as payment_model_1 from "../models/payment.model.js";
export const paymentController = {
    async list(req, res) {
        const q = payment_model_1.paymentListQuerySchema.parse(req.query);
        res.json(await payment_service_1.paymentService.list(req.user.organisation_id, q));
    },
    async createPaymentLink(req, res) {
        const body = payment_model_1.paymentLinkCreateSchema.parse(req.body);
        res.json(await payment_service_1.paymentService.createPaymentLink(req.user.organisation_id, body));
    },
};
