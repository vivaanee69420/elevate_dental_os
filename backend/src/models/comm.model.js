// ============================================================================
// Comm model — Zod schemas + inferred types for the communications domain.
// ============================================================================
import * as zod_1 from "zod";
export const commListQuerySchema = zod_1.z.object({
    contact_id: zod_1.z.string().uuid().optional(),
    lead_id: zod_1.z.string().uuid().optional(),
    channel: zod_1.z.string().optional(),
    integration_account_id: zod_1.z.string().uuid().optional(),
});
// Inbox thread list. `limit` is capped server-side: the browser asking for a
// page size is fine, the browser choosing an unbounded one is not.
export const commInboxQuerySchema = zod_1.z.object({
    integration_account_id: zod_1.z.string().uuid().optional(),
    search: zod_1.z.string().trim().max(200).optional(),
    channel: zod_1.z.string().max(40).optional(),
    unread_only: zod_1.z.coerce.boolean().optional().default(false),
    limit: zod_1.z.coerce.number().int().min(1).max(100).default(50),
    offset: zod_1.z.coerce.number().int().min(0).default(0),
});

export const commThreadQuerySchema = zod_1.z.object({
    thread_key: zod_1.z.string().min(3).max(200),
});

export const commSendSchema = zod_1.z.object({
    contact_id: zod_1.z.string().uuid().optional(),
    lead_id: zod_1.z.string().uuid().optional(),
    channel: zod_1.z.enum(['email', 'sms', 'whatsapp']),
    to: zod_1.z.string(),
    subject: zod_1.z.string().optional(),
    body: zod_1.z.string(),
});
