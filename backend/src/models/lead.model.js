// ============================================================================
// Lead model — Zod schemas + inferred types. No ORM; Supabase is the store,
// so "model" = the validated shape of data entering/leaving this domain.
// ============================================================================
import * as zod_1 from "zod";
export const LEAD_STATUSES = [
    'new', 'contact_attempted', 'contact_made', 'consultation_booked',
    'consultation_attended', 'treatment_started', 'treatment_completed',
    'not_proceeding', 'failed_to_attend',
];
export const leadListQuerySchema = zod_1.z.object({
    status: zod_1.z.enum(LEAD_STATUSES).optional(),
    practice_id: zod_1.z.string().uuid().optional(),
    integration_account_id: zod_1.z.string().uuid().optional(),
    assigned_to: zod_1.z.string().uuid().optional(),
    since: zod_1.z.string().optional(),
    // Filter to one GoHighLevel pipeline (drives the Pipeline screen — fetch only
    // the selected pipeline's leads server-side instead of slicing client-side).
    ghl_pipeline_id: zod_1.z.string().optional(),
    limit: zod_1.z.coerce.number().default(100),
});
// Pipeline definitions are per GHL Location — scope them to one subaccount.
export const pipelinesQuerySchema = zod_1.z.object({
    integration_account_id: zod_1.z.string().uuid().optional(),
});
export const leadCreateSchema = zod_1.z.object({
    contact_id: zod_1.z.string().uuid().optional(),
    contact: zod_1.z.object({
        first_name: zod_1.z.string().optional(),
        last_name: zod_1.z.string().optional(),
        email: zod_1.z.string().email().optional(),
        phone: zod_1.z.string().optional(),
    }).optional(),
    practice_id: zod_1.z.string().uuid().optional(),
    treatment: zod_1.z.string(),
    estimated_value_pence: zod_1.z.number().int().nonnegative(),
    source: zod_1.z.string().optional(),
    utm_source: zod_1.z.string().optional(),
    utm_medium: zod_1.z.string().optional(),
    utm_campaign: zod_1.z.string().optional(),
});
export const leadUpdateSchema = zod_1.z.object({
    status: zod_1.z.enum(LEAD_STATUSES).optional(),
    assigned_to: zod_1.z.string().uuid().nullable().optional(),
    estimated_value_pence: zod_1.z.number().int().nonnegative().optional(),
    treatment: zod_1.z.string().optional(),
    expected_close_date: zod_1.z.string().optional(),
});
