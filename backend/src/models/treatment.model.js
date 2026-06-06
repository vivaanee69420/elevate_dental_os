// ============================================================================
// Treatment model — Zod schemas for the treatment-mix domain.
// ============================================================================
import * as zod_1 from "zod";

// Treatment Mix list query: optional practice filter + an explicit [since, until)
// window (the global month/year/custom filter). `weeks` stays as a legacy
// trailing-window fallback when no since/until is sent.
export const treatmentMixQuerySchema = zod_1.z.object({
    practice_id: zod_1.z.string().uuid().optional(),
    weeks: zod_1.z.coerce.number().int().positive().max(520).optional(),
    since: zod_1.z.string().datetime().optional(),
    until: zod_1.z.string().datetime().optional(),
});
