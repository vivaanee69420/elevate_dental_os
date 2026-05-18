"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.membershipCreateSchema = void 0;
// ============================================================================
// Membership model — Zod schemas + inferred types.
// ============================================================================
const zod_1 = require("zod");
exports.membershipCreateSchema = zod_1.z.object({
    contact_id: zod_1.z.string().uuid(),
    plan_id: zod_1.z.string().uuid(),
    started_at: zod_1.z.string(),
});
