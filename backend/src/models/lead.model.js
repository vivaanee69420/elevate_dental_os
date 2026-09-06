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
// The ordered pipeline a lead walks. `not_proceeding` / `failed_to_attend` are
// TERMINAL, not stages — a lead can die at any point along this path.
export const FUNNEL_STAGES = [
    { key: 'new', label: 'New' },
    { key: 'contact_attempted', label: 'Contact attempted' },
    { key: 'contact_made', label: 'Contact made' },
    { key: 'consultation_booked', label: 'Consult booked' },
    { key: 'consultation_attended', label: 'Consult attended' },
    { key: 'treatment_started', label: 'Treatment started' },
];

// How far along FUNNEL_STAGES a lead in `status` got. -1 = not on the path.
//
// The terminal statuses are the reason this function exists. A lost lead has no
// stage of its own, but it certainly reached one before it was lost, and a
// funnel that drops lost leads entirely reports a top-of-funnel smaller than
// the number of leads received — which is never true.
//
// GoHighLevel does not tell us where a lead died, so we place a terminal lead
// at `new` (index 0): the ONLY thing we can assert without inventing history is
// that it existed. Deliberately conservative — it keeps the funnel's top bar
// equal to the true lead count and never overstates progress down the pipeline.
// If GHL stage history is ever synced, this is the single place to improve it.
const STAGE_INDEX = new Map(FUNNEL_STAGES.map((s, i) => [s.key, i]));
export function furthestStageIndex(status) {
    if (STAGE_INDEX.has(status)) return STAGE_INDEX.get(status);
    if (status === 'treatment_completed') return FUNNEL_STAGES.length - 1;
    if (status === 'not_proceeding' || status === 'failed_to_attend') return 0;
    return -1;
}

// Funnel window + practice scope. All optional: no window = all time.
export const leadFunnelQuerySchema = zod_1.z.object({
    since: zod_1.z.string().optional(),
    until: zod_1.z.string().optional(),
    practice_id: zod_1.z.string().uuid().optional(),
});

// CRM Reports scope. Same window semantics as the funnel.
export const leadReportQuerySchema = zod_1.z.object({
    since: zod_1.z.string().optional(),
    until: zod_1.z.string().optional(),
    practice_id: zod_1.z.string().uuid().optional(),
    integration_account_id: zod_1.z.string().uuid().optional(),
});

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
// CSV export — same board filters as leadListQuerySchema, minus `limit`: an
// export has no page size, it returns every matching row (see
// lead.repository.js `exportBatches`, which pages past PostgREST's 1000-row
// cap server-side rather than accepting a client-chosen limit).
export const leadExportQuerySchema = zod_1.z.object({
    status: zod_1.z.enum(LEAD_STATUSES).optional(),
    practice_id: zod_1.z.string().uuid().optional(),
    integration_account_id: zod_1.z.string().uuid().optional(),
    assigned_to: zod_1.z.string().uuid().optional(),
    since: zod_1.z.string().optional(),
    ghl_pipeline_id: zod_1.z.string().optional(),
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
