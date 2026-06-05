// ============================================================================
// Analytics model — Zod query schemas for the dashboard/insights endpoints.
// ============================================================================
import * as zod_1 from "zod";

// revenue-series ?months=12 — bounded so a hostile/garbled query can't ask
// for an unbounded loop. Coerced because query strings arrive as text.
// Optional custom date range (YYYY-MM-DD). When both present, overrides the
// rolling window. A single day = from==to; a month = its 1st..last.
const dateStr = zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();

// Scope + Period — the global analytics selector (GM Intelligence OS). scope is
// 'all' | 'practices' | 'academy' | 'lab' | <practice UUID>; resolved to a
// concrete entity filter by analyticsService.resolveScope. period 'day' means
// cash-collected-by-day (settled receipts), not production. pk = 'YYYY-MM' or
// 'YYYY-MM-DD'. Validating here stops a tampered scope reaching the repo.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCOPE_LITERALS = ['all', 'practices', 'academy', 'lab'];
export const scopeQuerySchema = zod_1.z.object({
    scope: zod_1.z.string().trim().default('all').refine(
        (s) => SCOPE_LITERALS.includes(s) || UUID_RE.test(s),
        { message: 'scope must be all|practices|academy|lab or a practice UUID' },
    ),
    period: zod_1.z.enum(['month', 'day']).default('month'),
    pk: zod_1.z.string().trim().regex(/^\d{4}-\d{2}(-\d{2})?$/).optional(),
});

// Treatment Economics Workbench model (POST body). All money in integer pence.
// Bounded so a hostile body can't overflow the solver; coerced since the client
// may send numeric strings. Pure compute — no persistence (Arch #3).
export const treatmentModelSchema = zod_1.z.object({
    key: zod_1.z.string().max(40).optional(),
    label: zod_1.z.string().max(80).optional(),
    unit: zod_1.z.enum(['case', 'implant']).default('case'),
    pricePence: zod_1.z.coerce.number().int().min(0).max(100_000_000),
    cbctPence: zod_1.z.coerce.number().int().min(0).max(100_000_000).default(0),
    marketingPct: zod_1.z.coerce.number().min(0).max(100).default(0),
    utilitiesPence: zod_1.z.coerce.number().int().min(0).max(100_000_000).default(0),
    surgeryRunCostPence: zod_1.z.coerce.number().int().min(0).max(100_000_000).default(0),
    labBillPence: zod_1.z.coerce.number().int().min(0).max(100_000_000).default(0),
    labMarginPct: zod_1.z.coerce.number().min(0).max(100).default(0),
    dentistPct: zod_1.z.coerce.number().min(0).max(100).default(0),
    targetMarginPct: zod_1.z.coerce.number().min(0).max(100).default(0),
    surgeries: zod_1.z.coerce.number().int().min(0).max(1000).default(0),
    casesPerSurgery: zod_1.z.coerce.number().int().min(0).max(10000).default(0),
    implantsPerPatient: zod_1.z.coerce.number().int().min(1).max(20).default(1),
    components: zod_1.z.array(zod_1.z.object({
        name: zod_1.z.string().max(80).default(''),
        qty: zod_1.z.coerce.number().int().min(0).max(1000).default(0),
        retailPence: zod_1.z.coerce.number().int().min(0).max(100_000_000).default(0),
        costPence: zod_1.z.coerce.number().int().min(0).max(100_000_000).default(0),
    })).max(50).default([]),
});

// Group Valuation state (POST /compute/valuation body). All money in integer
// pence; multiples/factors are plain numbers (the classification/region/tier
// tables live client-side and the resolved values are sent here — the formula
// is pure arithmetic). Bounded so a hostile body can't overflow; coerced since
// sliders may post numeric strings. Pure compute — no persistence (Arch #3).
const PENCE = zod_1.z.coerce.number().int().min(0).max(1_000_000_000_000); // ≤ £10bn
export const valuationStateSchema = zod_1.z.object({
    reportedEbitdaPence: PENCE,
    addBacksPence: PENCE.default(0),
    principalSalaryPence: PENCE.default(0),
    principalMultiple: zod_1.z.coerce.number().min(0).max(30).default(0),
    associateMultiple: zod_1.z.coerce.number().min(0).max(30).default(0),
    dsoMultiple: zod_1.z.coerce.number().min(0).max(30).default(0),
    regionFactor: zod_1.z.coerce.number().min(0.5).max(2).default(1),
    growthRatePct: zod_1.z.coerce.number().min(-100).max(200).default(10),
});

// Sale Planner trajectory (POST /compute/valuation/exit-plan body). `baselinePence`
// is today's midpoint (from the valuation result — not recomputed here).
export const valuationExitPlanSchema = zod_1.z.object({
    base: zod_1.z.object({
        ttmRevenuePence: PENCE.default(0),
        reportedEbitdaPence: PENCE.default(0),
    }),
    baselinePence: PENCE.default(0),
    principalSalaryPence: PENCE.default(0),
    plan: zod_1.z.object({
        targetValuePence: PENCE.default(0),
        targetYears: zod_1.z.coerce.number().int().min(1).max(40).default(5),
        futureEbitdaPence: PENCE.default(0),
        futureRevenuePence: PENCE.default(0),
        futureMultiple: zod_1.z.coerce.number().min(0).max(30).default(0),
        futureBuyerType: zod_1.z.enum(['principal', 'associate', 'dso']).default('associate'),
        addedSites: zod_1.z.coerce.number().int().min(0).max(500).default(0),
        siteCount: zod_1.z.coerce.number().int().min(0).max(500).default(0),
    }),
});

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
