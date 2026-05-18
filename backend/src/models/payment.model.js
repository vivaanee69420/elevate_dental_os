"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.paymentLinkCreateSchema = exports.paymentListQuerySchema = void 0;
// ============================================================================
// Payment model — Zod schemas + inferred types for the payments domain.
// ============================================================================
const zod_1 = require("zod");
exports.paymentListQuerySchema = zod_1.z.object({
    status: zod_1.z.string().optional(),
    since: zod_1.z.string().optional(),
});
exports.paymentLinkCreateSchema = zod_1.z.object({
    amount_pence: zod_1.z.number().int().positive(),
    description: zod_1.z.string(),
    contact_id: zod_1.z.string().uuid().optional(),
    lead_id: zod_1.z.string().uuid().optional(),
});
