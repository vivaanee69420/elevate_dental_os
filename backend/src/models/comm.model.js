// ============================================================================
// Comm model — Zod schemas + inferred types for the communications domain.
// ============================================================================
import * as zod_1 from "zod";
export const commListQuerySchema = zod_1.z.object({
    contact_id: zod_1.z.string().uuid().optional(),
    lead_id: zod_1.z.string().uuid().optional(),
    channel: zod_1.z.string().optional(),
});
export const commSendSchema = zod_1.z.object({
    contact_id: zod_1.z.string().uuid().optional(),
    lead_id: zod_1.z.string().uuid().optional(),
    channel: zod_1.z.enum(['email', 'sms', 'whatsapp']),
    to: zod_1.z.string(),
    subject: zod_1.z.string().optional(),
    body: zod_1.z.string(),
});
