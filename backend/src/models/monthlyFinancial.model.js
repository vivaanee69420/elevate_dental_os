// ============================================================================
// Monthly financial model — Zod schemas for manual P&L actuals entry.
// One row = one bucket amount for one period (YYYY-MM), optionally per practice.
// Mirrors the monthly_financials table (migration 20260101000014). All money
// is integer pence (project rule 2). source is forced to 'manual' server-side.
// ============================================================================
import * as zod_1 from "zod";

export const DENTAL_BUCKETS = ['revenue', 'staff', 'lab', 'materials', 'overhead', 'tax', 'other'];

const periodRegex = /^\d{4}-(0[1-9]|1[0-2])$/; // YYYY-MM

export const monthlyFinancialCreateSchema = zod_1.z.object({
    period: zod_1.z.string().regex(periodRegex, 'period must be YYYY-MM'),
    dental_bucket: zod_1.z.enum(DENTAL_BUCKETS),
    amount_pence: zod_1.z.number().int(),
    // Free-text account code; manual entries default to the bucket name so the
    // composite-unique key (org, period, account_code, practice, source) stays
    // stable on re-entry of the same line.
    account_code: zod_1.z.string().min(1).max(64).optional(),
    practice_id: zod_1.z.string().uuid().nullish(),
});

export const monthlyFinancialListQuerySchema = zod_1.z.object({
    from: zod_1.z.string().regex(periodRegex).optional(), // inclusive YYYY-MM
    to: zod_1.z.string().regex(periodRegex).optional(),   // inclusive YYYY-MM
    practice_id: zod_1.z.string().uuid().optional(),
});
