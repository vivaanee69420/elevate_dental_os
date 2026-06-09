// ============================================================================
// CRM settings model — Zod schemas. PUT is an upsert with a partial body
// (at least one field). Money stored as integer pence (treatments). Times are
// HH:MM strings (24h). All fields optional so partial updates are diffs.
// ============================================================================
import * as zod_1 from "zod";

const hhmm = zod_1.z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM');

const treatmentSchema = zod_1.z.object({
    name: zod_1.z.string().min(1),
    default_value_pence: zod_1.z.number().int().min(0),
});

export const settingsUpdateSchema = zod_1.z.object({
    treatments: zod_1.z.array(treatmentSchema).optional(),
    sources: zod_1.z.array(zod_1.z.string().min(1)).optional(),
    payment_plans: zod_1.z.array(zod_1.z.string().min(1)).optional(),
    gdpr_default_basis: zod_1.z.enum(['consent', 'legitimate_interest', 'contract', 'none']).optional(),
    quiet_hours_start: hhmm.optional(),
    quiet_hours_end: hhmm.optional(),
    quiet_hours_tz: zod_1.z.string().min(1).optional(),
    marketing_default_consent: zod_1.z.boolean().optional(),
}).refine((o) => Object.keys(o).length > 0, { message: 'no fields to update' });
