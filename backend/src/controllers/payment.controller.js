import * as payment_service_1 from "../services/payment.service.js";
import * as payment_model_1 from "../models/payment.model.js";
import { daysQuerySchema } from "../models/common.model.js";
import * as zod_1 from "zod";

// ?practice_id=<uuid>&since=<iso>&until=<iso>, all optional. Empty → null so
// "no scope" stays valid (matches the prior `|| null` behaviour).
const optStr = zod_1.z.preprocess((v) => (v === '' || v == null ? null : v), zod_1.z.string().max(64).nullable());
const summaryQuerySchema = zod_1.z.object({
    practice_id: optStr,
    since: optStr,
    until: optStr,
});

export const paymentController = {
    async list(req, res) {
        const q = payment_model_1.paymentListQuerySchema.parse(req.query);
        res.json(await payment_service_1.paymentService.list(req.user.organisation_id, q));
    },
    async createPaymentLink(req, res) {
        const body = payment_model_1.paymentLinkCreateSchema.parse(req.body);
        res.json(await payment_service_1.paymentService.createPaymentLink(req.user.organisation_id, body));
    },
    async createManual(req, res) {
        const body = payment_model_1.paymentManualCreateSchema.parse(req.body);
        res.json(await payment_service_1.paymentService.createManual(req.user.organisation_id, body));
    },
    async sourceBreakdown(req, res) {
        const { days } = daysQuerySchema.parse(req.query);
        res.json(await payment_service_1.paymentService.sourceBreakdown(req.user.organisation_id, days));
    },
    async summary(req, res) {
        const q = summaryQuerySchema.parse(req.query);
        res.json(await payment_service_1.paymentService.summary(req.user.organisation_id, {
            practiceId: q.practice_id,
            since: q.since,
            until: q.until,
        }));
    },
};
