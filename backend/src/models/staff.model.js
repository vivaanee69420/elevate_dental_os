// ============================================================================
// Staff model — Zod schemas for the staff (team roster) domain.
// ============================================================================
import * as zod_1 from "zod";

export const staffListQuerySchema = zod_1.z.object({
    practice_id: zod_1.z.string().uuid().optional(),
});
