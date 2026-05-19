// ============================================================================
// File model — Zod schemas + inferred types.
// ============================================================================
import * as zod_1 from "zod";
export const filePresignSchema = zod_1.z.object({
    filename: zod_1.z.string(),
    content_type: zod_1.z.string(),
    related_entity_type: zod_1.z.string().optional(),
    related_entity_id: zod_1.z.string().uuid().optional(),
});
