"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.snapshotCreateSchema = exports.businessHealthUpdateSchema = void 0;
// ============================================================================
// Business Health model — Zod schemas + inferred types for validated input.
// ============================================================================
const zod_1 = require("zod");
exports.businessHealthUpdateSchema = zod_1.z.object({
    setup_step: zod_1.z.number().optional(),
    setup_completed: zod_1.z.boolean().optional(),
    baseline: zod_1.z.record(zod_1.z.any()).optional(),
    targets: zod_1.z.record(zod_1.z.any()).optional(),
});
exports.snapshotCreateSchema = zod_1.z.object({
    label: zod_1.z.string().optional(),
    metrics: zod_1.z.record(zod_1.z.any()),
});
