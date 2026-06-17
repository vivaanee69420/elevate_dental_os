// ============================================================================
// Contact model — Zod schemas + inferred types for the contacts domain.
// ============================================================================
import * as zod_1 from "zod";
export const contactListQuerySchema = zod_1.z.object({
    type: zod_1.z.enum(['lead', 'patient', 'lapsed']).optional(),
    // Length-capped; PostgREST filter metacharacters are stripped in the
    // repository before interpolation into .or() (see contact.repository.list).
    search: zod_1.z.string().max(80).optional(),
    practice_id: zod_1.z.string().uuid().optional(),
    integration_account_id: zod_1.z.string().uuid().optional(),
    // Filter by integration origin, e.g. 'dentally' | 'gohighlevel' (drives the
    // Dentally / GHL contact tabs on the Contacts screen). Free string — the set
    // of sources grows as integrations are added.
    source: zod_1.z.string().optional(),
    limit: zod_1.z.coerce.number().default(100),
    page: zod_1.z.coerce.number().min(1).default(1),
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
