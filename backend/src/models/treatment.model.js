// ============================================================================
// Treatment model — Zod schemas for the treatment-mix domain.
// ============================================================================
import * as zod_1 from "zod";

// Treatment Mix list query: optional practice filter + trailing-window weeks.
export const treatmentMixQuerySchema = zod_1.z.object({
    practice_id: zod_1.z.string().uuid().optional(),
    weeks: zod_1.z.coerce.number().int().positive().max(520).optional(),
});
