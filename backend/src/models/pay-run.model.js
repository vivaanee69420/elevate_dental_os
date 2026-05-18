"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.payRunCalculateSchema = void 0;
// ============================================================================
// Pay-run model — Zod schemas + inferred types for the pay-runs domain.
// ============================================================================
const zod_1 = require("zod");
exports.payRunCalculateSchema = zod_1.z.object({
    period_start: zod_1.z.string(),
    period_end: zod_1.z.string(),
    lines: zod_1.z.array(zod_1.z.object({
        associate_id: zod_1.z.string().uuid(),
        production_pence: zod_1.z.number().int().nonnegative(),
        lab_cost_pence: zod_1.z.number().int().nonnegative(),
        prev_balance_pence: zod_1.z.number().int().optional(),
    })),
});
