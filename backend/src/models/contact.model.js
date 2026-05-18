"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.contactUpdateSchema = exports.contactCreateSchema = exports.contactListQuerySchema = void 0;
// ============================================================================
// Contact model — Zod schemas + inferred types for the contacts domain.
// ============================================================================
const zod_1 = require("zod");
exports.contactListQuerySchema = zod_1.z.object({
    type: zod_1.z.enum(['lead', 'patient', 'lapsed']).optional(),
    search: zod_1.z.string().optional(),
    practice_id: zod_1.z.string().uuid().optional(),
    limit: zod_1.z.coerce.number().default(100),
});
exports.contactCreateSchema = zod_1.z.object({
    type: zod_1.z.enum(['lead', 'patient', 'lapsed']).default('lead'),
    first_name: zod_1.z.string().optional(),
    last_name: zod_1.z.string().optional(),
    email: zod_1.z.string().email().optional(),
    phone: zod_1.z.string().optional(),
    practice_id: zod_1.z.string().uuid().optional(),
    source: zod_1.z.string().optional(),
    marketing_consent: zod_1.z.boolean().optional(),
    sms_consent: zod_1.z.boolean().optional(),
    tags: zod_1.z.array(zod_1.z.string()).optional(),
});
exports.contactUpdateSchema = zod_1.z.record(zod_1.z.any());
