// ============================================================================
// Pay-run model — Zod schemas + inferred types for the pay-runs domain.
// ============================================================================
import * as zod_1 from "zod";
export const payRunCalculateSchema = zod_1.z.object({
    period_start: zod_1.z.string(),
    period_end: zod_1.z.string(),
    lines: zod_1.z.array(zod_1.z.object({
        associate_id: zod_1.z.string().uuid(),
        production_pence: zod_1.z.number().int().nonnegative(),
        lab_cost_pence: zod_1.z.number().int().nonnegative(),
        prev_balance_pence: zod_1.z.number().int().optional(),
    })),
});

// Draft (preview) pay run: production is derived from treatment_plans for the
// period — the client supplies only the window. Dates are YYYY-MM-DD.
export const payRunDraftQuerySchema = zod_1.z.object({
    period_start: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    period_end: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
