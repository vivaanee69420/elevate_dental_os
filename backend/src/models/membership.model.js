// ============================================================================
// Membership model — Zod schemas + inferred types.
// ============================================================================
import * as zod_1 from "zod";
export const membershipCreateSchema = zod_1.z.object({
    contact_id: zod_1.z.string().uuid(),
    plan_id: zod_1.z.string().uuid(),
    started_at: zod_1.z.string(),
});
