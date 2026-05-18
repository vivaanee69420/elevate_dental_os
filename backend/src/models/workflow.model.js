"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.workflowCreateSchema = void 0;
// ============================================================================
// Workflow model — Zod schemas + inferred types.
// ============================================================================
const zod_1 = require("zod");
exports.workflowCreateSchema = zod_1.z.object({
    name: zod_1.z.string(),
    trigger_type: zod_1.z.string(),
    trigger_config: zod_1.z.record(zod_1.z.any()).optional(),
    steps: zod_1.z.array(zod_1.z.record(zod_1.z.any())),
    active: zod_1.z.boolean().default(true),
});
