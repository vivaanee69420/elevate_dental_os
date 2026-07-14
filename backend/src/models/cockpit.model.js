// ============================================================================
// Cockpit model — Zod query schema for GET /api/cockpit. Mirrors the
// scopeQuerySchema window fields (analytics.model.js) — permissive
// Date.parse-able ISO strings, optional scope for a future practice filter.
// ============================================================================
import * as zod_1 from "zod";

const isoDateTime = zod_1.z.string().trim().refine((s) => !Number.isNaN(Date.parse(s)), { message: 'invalid ISO date' }).optional();

export const cockpitQuerySchema = zod_1.z.object({
    since: isoDateTime,
    until: isoDateTime,
    scope: zod_1.z.string().trim().optional(),
});
