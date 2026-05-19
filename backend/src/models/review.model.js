// ============================================================================
// Review model — Zod schemas + inferred types.
// ============================================================================
import * as zod_1 from "zod";
export const reviewRespondSchema = zod_1.z.object({
    response: zod_1.z.string(),
});
