// ============================================================================
// Zod schemas for the tax endpoints.
//
// Sections are OPTIONAL with no defaults, so the service writes only what the
// caller sent — the same rule the wealth save now follows, after a default of
// [] there meant saving one section wiped the others.
// ============================================================================
import * as zod_1 from "zod";

const YMD = zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

export const taxSettingsSchema = zod_1.z.object({
    entity_type: zod_1.z.enum(['limited_company', 'sole_trader', 'partnership', 'llp']).nullable().optional(),
    vat_registered: zod_1.z.boolean().optional(),
    vat_number: zod_1.z.string().trim().max(20).nullable().optional(),
    vat_scheme: zod_1.z.enum(['standard', 'cash', 'flat_rate', 'annual']).nullable().optional(),
    vat_stagger: zod_1.z.coerce.number().int().min(1).max(3).nullable().optional(),
    prices_include_vat: zod_1.z.boolean().optional(),
    year_end_day: zod_1.z.coerce.number().int().min(1).max(31).nullable().optional(),
    year_end_month: zod_1.z.coerce.number().int().min(1).max(12).nullable().optional(),
    associated_companies: zod_1.z.coerce.number().int().min(1).max(999).optional(),
}).strip();

export const liabilitySchema = zod_1.z.object({
    description: zod_1.z.string().trim().min(1).max(300),
    // null CLEARS the mapping. "No row" is already how unmapped is stored, so
    // a nullable liability column would give one state two spellings.
    liability: zod_1.z.enum(['exempt', 'standard', 'outside_scope']).nullable(),
    note: zod_1.z.string().trim().max(500).nullable().optional(),
}).strip();

export const taxQuerySchema = zod_1.z.object({
    on: YMD.optional(),
    since: YMD.optional(),
    until: YMD.optional(),
    practice_id: zod_1.z.string().uuid().optional(),
}).strip();
