// ============================================================================
// Workflow model — Zod schemas + inferred types.
// ============================================================================
import * as zod_1 from "zod";
export const workflowCreateSchema = zod_1.z.object({
    name: zod_1.z.string(),
    trigger_type: zod_1.z.string(),
    trigger_config: zod_1.z.record(zod_1.z.any()).optional(),
    steps: zod_1.z.array(zod_1.z.record(zod_1.z.any())),
    active: zod_1.z.boolean().default(true),
});

// All fields optional on update; at least one must be present.
export const workflowUpdateSchema = zod_1.z.object({
    name: zod_1.z.string().optional(),
    trigger_type: zod_1.z.string().optional(),
    trigger_config: zod_1.z.record(zod_1.z.any()).optional(),
    steps: zod_1.z.array(zod_1.z.record(zod_1.z.any())).optional(),
    active: zod_1.z.boolean().optional(),
}).refine((o) => Object.keys(o).length > 0, { message: 'no fields to update' });
