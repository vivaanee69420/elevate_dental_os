// ============================================================================
// Analytics model — Zod query schemas for the dashboard/insights endpoints.
// ============================================================================
import * as zod_1 from "zod";

// revenue-series ?months=12 — bounded so a hostile/garbled query can't ask
// for an unbounded loop. Coerced because query strings arrive as text.
export const seriesQuerySchema = zod_1.z.object({
    months: zod_1.z.coerce.number().int().min(1).max(36).default(12),
});

// ai-insights ?days=30 — rolling window for the leads/payments rollups.
// Bounded so a garbled query can't ask for an unbounded scan.
export const windowQuerySchema = zod_1.z.object({
    days: zod_1.z.coerce.number().int().min(1).max(365).default(30),
});
