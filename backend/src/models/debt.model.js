// ============================================================================
// Debt model — Zod schema for the debt domain query.
// ============================================================================
import * as zod_1 from "zod";
export const debtListQuerySchema = zod_1.z.object({
    practice_id: zod_1.z.string().uuid().optional(),
});
