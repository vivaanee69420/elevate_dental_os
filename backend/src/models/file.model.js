"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.filePresignSchema = void 0;
// ============================================================================
// File model — Zod schemas + inferred types.
// ============================================================================
const zod_1 = require("zod");
exports.filePresignSchema = zod_1.z.object({
    filename: zod_1.z.string(),
    content_type: zod_1.z.string(),
    related_entity_type: zod_1.z.string().optional(),
    related_entity_id: zod_1.z.string().uuid().optional(),
});
