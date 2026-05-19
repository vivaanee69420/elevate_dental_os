// ============================================================================
// Contact model — Zod schemas + inferred types for the contacts domain.
// ============================================================================
import * as zod_1 from "zod";
export const contactListQuerySchema = zod_1.z.object({
    type: zod_1.z.enum(['lead', 'patient', 'lapsed']).optional(),
    search: zod_1.z.string().optional(),
    practice_id: zod_1.z.string().uuid().optional(),
    limit: zod_1.z.coerce.number().default(100),
});
export const contactCreateSchema = zod_1.z.object({
    type: zod_1.z.enum(['lead', 'patient', 'lapsed']).default('lead'),
    first_name: zod_1.z.string().optional(),
    last_name: zod_1.z.string().optional(),
    email: zod_1.z.string().email().optional(),
    phone: zod_1.z.string().optional(),
    practice_id: zod_1.z.string().uuid().optional(),
    source: zod_1.z.string().optional(),
    marketing_consent: zod_1.z.boolean().optional(),
    sms_consent: zod_1.z.boolean().optional(),
    tags: zod_1.z.array(zod_1.z.string()).optional(),
});
export const contactUpdateSchema = zod_1.z.record(zod_1.z.any());
