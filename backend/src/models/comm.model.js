"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.commSendSchema = exports.commListQuerySchema = void 0;
// ============================================================================
// Comm model — Zod schemas + inferred types for the communications domain.
// ============================================================================
const zod_1 = require("zod");
exports.commListQuerySchema = zod_1.z.object({
    contact_id: zod_1.z.string().uuid().optional(),
    lead_id: zod_1.z.string().uuid().optional(),
    channel: zod_1.z.string().optional(),
});
exports.commSendSchema = zod_1.z.object({
    contact_id: zod_1.z.string().uuid().optional(),
    lead_id: zod_1.z.string().uuid().optional(),
    channel: zod_1.z.enum(['email', 'sms', 'whatsapp']),
    to: zod_1.z.string(),
    subject: zod_1.z.string().optional(),
    body: zod_1.z.string(),
});
