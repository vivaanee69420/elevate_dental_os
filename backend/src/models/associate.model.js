// ============================================================================
// Associate model — Zod query schema for the associates roster endpoint.
// ============================================================================
import * as zod_1 from "zod";

export const associateListQuerySchema = zod_1.z.object({
    practice_id: zod_1.z.string().uuid().optional(),
    weeks: zod_1.z.coerce.number().int().min(1).max(104).optional().default(52),
});
