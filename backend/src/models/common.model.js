// ============================================================================
// Common model — shared Zod validators reused across controllers/routes so the
// same input shapes (UUID path params, provider slugs, scope queries) are
// validated identically everywhere. Errors bubble to middleware/errors.js → 400.
// ============================================================================
import * as zod_1 from "zod";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A canonical UUID string. Every business table keys on a UUID id, so a
// malformed :id is a client error (400) — without this it reaches Postgres as
// an invalid uuid (22P02) and surfaces as an opaque 500.
export const uuid = zod_1.z.string().regex(UUID_RE, 'must be a UUID');

// :id path param.
export const idParamSchema = zod_1.z.object({ id: uuid });

// :provider path param — connector slug (lowercase + underscore). Existence is
// validated downstream by getProvider(); this just rejects junk before it gets
// there (path traversal, control chars, absurd length).
export const providerParamSchema = zod_1.z.object({
    provider: zod_1.z.string().trim().min(1).max(40).regex(/^[a-z0-9_]+$/i, 'invalid provider'),
});

// Optional ?practice_id=<uuid> scope filter. Empty string → undefined (the
// prior `req.query.practice_id || undefined` behaviour) so "no filter" is valid.
export const practiceQuerySchema = zod_1.z.object({
    practice_id: zod_1.z.preprocess(
        (v) => (v === '' || v == null ? undefined : v),
        uuid.optional(),
    ),
});

// ?days=N window, clamped 1..365. `.catch(30)` keeps the prior lenient
// behaviour (bad/absent → default) while bounding the value that reaches SQL.
export const daysQuerySchema = zod_1.z.object({
    days: zod_1.z.coerce.number().int().min(1).max(365).catch(30),
});
