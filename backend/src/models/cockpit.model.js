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

// ============================================================================
// Lazy detail-endpoint query schema (leads/treatments/cashup-days). Unlike
// the main cockpit endpoint (scope-based), these take practiceId directly.
// limit/offset are coerced from query strings; the service clamps limit<=500
// and defaults — this schema just validates shape.
// ============================================================================
const UUID_RE = /^[0-9a-f-]{36}$/i;

export const cockpitDetailQuerySchema = zod_1.z.object({
    since: isoDateTime,
    until: isoDateTime,
    practiceId: zod_1.z.string().trim().regex(UUID_RE, { message: 'invalid practiceId' }).optional(),
    limit: zod_1.z.coerce.number().int().positive().optional(),
    offset: zod_1.z.coerce.number().int().nonnegative().optional(),
});

export const cockpitLeadsDetailQuerySchema = cockpitDetailQuerySchema.extend({
    channel: zod_1.z.string().trim().optional(),
});
