// ============================================================================
// Payment model — Zod schemas + inferred types for the payments domain.
// ============================================================================
import * as zod_1 from "zod";
export const paymentListQuerySchema = zod_1.z.object({
    status: zod_1.z.string().optional(),
    since: zod_1.z.string().optional(),
    practice_id: zod_1.z.string().uuid().optional(),
    page: zod_1.z.coerce.number().int().min(1).default(1),
    limit: zod_1.z.coerce.number().int().min(1).max(100).default(25),
});
export const paymentLinkCreateSchema = zod_1.z.object({
    amount_pence: zod_1.z.number().int().positive(),
    description: zod_1.z.string(),
    contact_id: zod_1.z.string().uuid().optional(),
    lead_id: zod_1.z.string().uuid().optional(),
});
export const paymentManualCreateSchema = zod_1.z.object({
    practice_id: zod_1.z.string().uuid(),
    contact_id: zod_1.z.string().uuid().optional(),
    lead_id: zod_1.z.string().uuid().optional(),
    amount_pence: zod_1.z.number().int().positive(),
    method: zod_1.z.enum(['card', 'apple_pay', 'google_pay', 'bank_transfer', 'cash', 'direct_debit', 'finance', 'card_on_file', 'pay_link']).optional(),
    status: zod_1.z.enum(['pending', 'processing', 'settled', 'failed', 'refunded', 'disputed']).default('settled'),
    description: zod_1.z.string().optional(),
    processed_at: zod_1.z.string().optional(),
});
