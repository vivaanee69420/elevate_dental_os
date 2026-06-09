// ============================================================================
// CRM template model — Zod schemas. channel + name + body required on create;
// subject only meaningful for email. Update = all-optional, at least one field.
// ============================================================================
import * as zod_1 from "zod";

export const templateCreateSchema = zod_1.z.object({
    channel: zod_1.z.enum(['sms', 'email']),
    name: zod_1.z.string().min(1),
    subject: zod_1.z.string().optional().nullable(),
    body: zod_1.z.string().min(1),
});

export const templateUpdateSchema = zod_1.z.object({
    channel: zod_1.z.enum(['sms', 'email']).optional(),
    name: zod_1.z.string().min(1).optional(),
    subject: zod_1.z.string().optional().nullable(),
    body: zod_1.z.string().min(1).optional(),
    is_archived: zod_1.z.boolean().optional(),
}).refine((o) => Object.keys(o).length > 0, { message: 'no fields to update' });

export const templateListQuerySchema = zod_1.z.object({
    channel: zod_1.z.enum(['sms', 'email']).optional(),
});
