// ============================================================================
// Payment model — Zod schemas + inferred types for the payments domain.
// ============================================================================
import * as zod_1 from "zod";
export const paymentListQuerySchema = zod_1.z.object({
    status: zod_1.z.string().optional(),
    since: zod_1.z.string().optional(),
});
export const paymentLinkCreateSchema = zod_1.z.object({
    amount_pence: zod_1.z.number().int().positive(),
    description: zod_1.z.string(),
    contact_id: zod_1.z.string().uuid().optional(),
    lead_id: zod_1.z.string().uuid().optional(),
});
