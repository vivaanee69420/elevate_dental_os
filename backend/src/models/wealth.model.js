// ============================================================================
// Wealth models — Zod schemas for the personal-wealth Exit Plan / FIRE screens
// (DentaCFO gap Phase 4). Money is INTEGER PENCE; percentages/multiples are
// plain numbers. Two families:
//   - wealthInputsSchema: the PERSISTED personal balance sheet + FIRE/sale knobs
//     (PUT /api/wealth/inputs body) → maps to the wealth_inputs JSONB columns.
//   - saleWaterfallSchema / firePlanSchema: pure /compute/ bodies (slider-driven
//     recompute, no persistence) consumed by lib/formulas.js.
// Bounded so a hostile body can't overflow; coerced since sliders may post
// numeric strings.
// ============================================================================
import * as zod_1 from "zod";

const PENCE = zod_1.z.coerce.number().int().min(0).max(1_000_000_000_000); // ≤ £10bn
const PCT = zod_1.z.coerce.number().min(0).max(100);

// ── persisted line-items ────────────────────────────────────────────────────
const assetSchema = zod_1.z.object({
    name: zod_1.z.string().trim().max(120).default(''),
    valuePence: PENCE.default(0),
    type: zod_1.z.enum(['Business', 'Property', 'Pension', 'Investments', 'Cash']).default('Investments'),
    growthPct: zod_1.z.coerce.number().min(-100).max(200).default(0),
    // Marketable / drawdown-able toward FIRE. Primary residence is NOT liquid.
    liquid: zod_1.z.boolean().default(true),
});

const liabilitySchema = zod_1.z.object({
    name: zod_1.z.string().trim().max(120).default(''),
    valuePence: PENCE.default(0),
    ratePct: zod_1.z.coerce.number().min(0).max(100).default(0),
});

const pensionSchema = zod_1.z.object({
    name: zod_1.z.string().trim().max(120).default(''),
    balancePence: PENCE.default(0),
    contributionsYtdPence: PENCE.default(0),
    type: zod_1.z.enum(['SIPP', 'NHS', 'Director']).default('SIPP'),
});

const propertySchema = zod_1.z.object({
    name: zod_1.z.string().trim().max(120).default(''),
    address: zod_1.z.string().trim().max(200).default(''),
    valuePence: PENCE.default(0),
    mortgagePence: PENCE.default(0),
    monthlyIncomePence: PENCE.default(0),
    monthlyCostPence: PENCE.default(0),
    yieldPct: zod_1.z.coerce.number().min(0).max(100).nullable().default(null),
    type: zod_1.z.enum(['Residential', 'Buy-to-let']).default('Residential'),
});

const fireSettingsSchema = zod_1.z.object({
    targetAnnualSpendPence: PENCE.default(0),
    withdrawalRatePct: zod_1.z.coerce.number().min(0.5).max(20).default(4),
    growthRatePct: zod_1.z.coerce.number().min(-100).max(200).default(7),
    annualSavingsPence: PENCE.default(0),
    horizonYears: zod_1.z.coerce.number().int().min(1).max(50).default(10),
});

const saleSettingsSchema = zod_1.z.object({
    ownerSharePct: PCT.default(100),
    businessDebtPence: PENCE.default(0),
    freeholdEquityPence: PENCE.default(0),
    acquisitionCostPence: PENCE.default(0),
    badrLifetimeUsedPence: PENCE.default(0),
    // Seed the practice EV from the live valuation midpoint; when false the
    // service uses a manual override (enterpriseValuePence below).
    useLiveValuation: zod_1.z.boolean().default(true),
    enterpriseValuePence: PENCE.default(0),
});

// ── Exit Plan (canonical, faithful to the GM demo `exitCalc`) ────────────────
// Persisted Exit Plan state — stored in the wealth_inputs.fire JSONB column
// (the legacy `sale` column is now unused). Money is INTEGER PENCE.
const AGE = zod_1.z.coerce.number().int().min(18).max(100);
const personShareSchema = zod_1.z.object({
    name: zod_1.z.string().trim().max(120).default(''),
    share: zod_1.z.coerce.number().min(0).max(100).default(1),
});
const freeholdSchema = zod_1.z.object({
    name: zod_1.z.string().trim().max(120).default(''),
    valuePence: PENCE.default(0),
    rentPence: PENCE.default(0),
});
export const exitPlanInputSchema = zod_1.z.object({
    incomePence: PENCE.default(0),                                  // annual post-tax income wanted
    incomePer: zod_1.z.enum(['year', 'month']).default('year'),     // display preference
    people: zod_1.z.array(personShareSchema).min(1).max(10).default([{ name: 'You', share: 1 }]),
    currentAge: AGE.default(45),
    retireAge: AGE.default(57),
    freeholds: zod_1.z.array(freeholdSchema).max(20).default([]),
    withdrawPct: zod_1.z.coerce.number().min(2).max(8).default(4),
    returnPct: zod_1.z.coerce.number().min(0).max(30).default(8),
    currentValuePence: PENCE.default(0),                           // manual override of group value today
    useLiveValuation: zod_1.z.boolean().default(true),             // seed currentValue from live midpoint
    agentPct: zod_1.z.coerce.number().min(0).max(20).default(1.5),
    cgtPct: zod_1.z.coerce.number().min(0).max(50).default(18),
    baseCostPence: PENCE.default(0),
    existingInvestPence: PENCE.default(0),
    targetSalePence: PENCE.default(0),                             // 0 = use the reverse-solved required sale
});

// Full persisted blob (PUT /inputs). Every section defaults so a partial body
// is valid and a never-configured org reads sane empties.
export const wealthInputsSchema = zod_1.z.object({
    assets: zod_1.z.array(assetSchema).max(100).default([]),
    liabilities: zod_1.z.array(liabilitySchema).max(100).default([]),
    pensions: zod_1.z.array(pensionSchema).max(100).default([]),
    properties: zod_1.z.array(propertySchema).max(100).default([]),
    exit: exitPlanInputSchema.default({}),
});

// Pure recompute body for the Exit Plan sliders (audit-exempt). The screen posts
// the full input; currentValuePence is whatever it last seeded from /fire.
export const exitPlanComputeSchema = exitPlanInputSchema;

// ── pure /compute bodies ─────────────────────────────────────────────────────
export const saleWaterfallSchema = zod_1.z.object({
    enterpriseValuePence: PENCE.default(0),
    businessDebtPence: PENCE.default(0),
    ownerSharePct: PCT.default(100),
    acquisitionCostPence: PENCE.default(0),
    freeholdEquityPence: PENCE.default(0),
    badrLifetimeUsedPence: PENCE.default(0),
});

export const firePlanSchema = zod_1.z.object({
    liquidAssetsPence: PENCE.default(0),
    liabilitiesPence: PENCE.default(0),
    businessNetProceedsPence: PENCE.default(0),
    targetAnnualSpendPence: PENCE.default(0),
    withdrawalRatePct: zod_1.z.coerce.number().min(0.5).max(20).default(4),
    growthRatePct: zod_1.z.coerce.number().min(-100).max(200).default(7),
    annualSavingsPence: PENCE.default(0),
    horizonYears: zod_1.z.coerce.number().int().min(1).max(50).default(10),
});
