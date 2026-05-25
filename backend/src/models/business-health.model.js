// ============================================================================
// Business Health model — Zod schemas + inferred types for validated input.
// ============================================================================
import * as zod_1 from "zod";
export const businessHealthUpdateSchema = zod_1.z.object({
    setup_step: zod_1.z.number().optional(),
    setup_completed: zod_1.z.boolean().optional(),
    baseline: zod_1.z.record(zod_1.z.any()).optional(),
    targets: zod_1.z.record(zod_1.z.any()).optional(),
});
export const snapshotCreateSchema = zod_1.z.object({
    label: zod_1.z.string().optional(),
    metrics: zod_1.z.record(zod_1.z.any()),
});
export const cadenceUpdateSchema = zod_1.z.object({
    snapshot_frequency: zod_1.z.enum(['weekly', 'monthly']),
});
