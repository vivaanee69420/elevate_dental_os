// ============================================================================
// Analytics model — Zod query schemas for the dashboard/insights endpoints.
// ============================================================================
import * as zod_1 from "zod";

// revenue-series ?months=12 — bounded so a hostile/garbled query can't ask
// for an unbounded loop. Coerced because query strings arrive as text.
// Optional custom date range (YYYY-MM-DD). When both present, overrides the
// rolling window. A single day = from==to; a month = its 1st..last.
const dateStr = zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();

export const seriesQuerySchema = zod_1.z.object({
    months: zod_1.z.coerce.number().int().min(1).max(36).default(12),
    practice_id: zod_1.z.string().uuid().optional(),
    from: dateStr,
    to: dateStr,
});

// ai-insights ?days=30 — rolling window for the leads/payments rollups.
// Bounded so a garbled query can't ask for an unbounded scan.
export const windowQuerySchema = zod_1.z.object({
    days: zod_1.z.coerce.number().int().min(1).max(365).default(30),
});

// cashflow ?weeks=13 — rolling forecast horizon, bounded.
export const weeksQuerySchema = zod_1.z.object({
    weeks: zod_1.z.coerce.number().int().min(1).max(52).default(13),
    practice_id: zod_1.z.string().uuid().optional(),
    from: dateStr,
    to: dateStr,
});

// /financial — owner-editable balance-sheet assumptions (the estimated BS is
// driven by these, surfaced as inputs the owner owns, not hidden constants).
export const financialQuerySchema = zod_1.z.object({
    dsoDays: zod_1.z.coerce.number().int().min(0).max(365).default(45),
    payableDays: zod_1.z.coerce.number().int().min(0).max(365).default(30),
    practice_id: zod_1.z.string().uuid().optional(),
    from: dateStr,
    to: dateStr,
});
