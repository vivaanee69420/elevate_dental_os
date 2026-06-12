// ============================================================================
// Wealth service — personal-wealth Exit Plan / FIRE (DentaCFO gap Phase 4).
// Owner-only. Orchestrates the persisted personal balance sheet (wealth_inputs)
// with the live business valuation and the pure formulas:
//   - calculateSaleWaterfall  → what the owner nets in cash from a practice sale
//   - calculateFirePlan       → does net worth clear the FIRE number (4% rule)
// Money is INTEGER PENCE throughout. Business logic only — no data access (repo)
// and no HTTP shaping (controller).
// ============================================================================
import * as wealth_repository_1 from "../repositories/wealth.repository.js";
import * as analytics_service_1 from "./analytics.service.js";
import * as formulas_1 from "../lib/formulas.js";

// The canonical Exit Plan defaults a never-configured org reads (mirror the
// exitPlanInputSchema defaults so the UI gets a full, stable shape without a
// saved row). Persisted in the wealth_inputs.fire JSONB column.
const EMPTY_EXIT = {
    incomePence: 0, incomePer: 'year', people: [{ name: 'You', share: 1 }],
    currentAge: 45, retireAge: 57, freeholds: [],
    withdrawPct: 4, returnPct: 8, currentValuePence: 0, useLiveValuation: true,
    ebitdaMarginPct: 18,
    agentPct: 1.5, cgtPct: 18, baseCostPence: 0, existingInvestPence: 0, targetSalePence: 0,
};

export const wealthService = {
    // Saved personal-wealth inputs in the camelCase shape the screens consume,
    // or sane empties when never configured. The Exit Plan state lives in the
    // `fire` JSONB column (exposed as `exit`).
    async getInputs(orgId) {
        const row = await wealth_repository_1.wealthRepository.get(orgId);
        return {
            assets: row?.assets ?? [],
            liabilities: row?.liabilities ?? [],
            pensions: row?.pensions ?? [],
            properties: row?.properties ?? [],
            exit: { ...EMPTY_EXIT, ...(row?.fire ?? {}) },
            updatedAt: row?.updated_at ?? null,
        };
    },

    // Persist the validated blob (wealthInputsSchema output) then read it back.
    // Exit Plan state is stored in the `fire` column; legacy `sale` is cleared.
    async saveInputs(orgId, inputs, userId) {
        await wealth_repository_1.wealthRepository.upsert(orgId, {
            assets: inputs.assets,
            liabilities: inputs.liabilities,
            pensions: inputs.pensions,
            properties: inputs.properties,
            fire: inputs.exit,
            sale: {},
        }, userId);
        return this.getInputs(orgId);
    },

    // Pure recompute endpoints (slider-driven, no persistence).
    computeSaleWaterfall(body) {
        return (0, formulas_1.calculateSaleWaterfall)(body);
    },
    computeFirePlan(body) {
        return (0, formulas_1.calculateFirePlan)(body);
    },
    // Canonical Exit Plan recompute. The screen passes the full input (incl. the
    // currentValuePence it last seeded from /fire); baseYear is the current year.
    computeExitPlan(body) {
        return (0, formulas_1.calculateExitPlan)({ ...body, baseYear: new Date().getFullYear() });
    },

    // Personal balance sheet for the Net Worth screen. Totals by class + simple
    // book net worth (assets − liabilities). The business line(s) here are the
    // owner's equity at the value they entered; the post-tax SALE value is the
    // separate Exit Plan concern (see exitPlan).
    async netWorth(orgId) {
        const { assets, liabilities } = await this.getInputs(orgId);
        const byType = {};
        let totalAssetsPence = 0;
        for (const a of assets) {
            const v = Math.round(a.valuePence || 0);
            totalAssetsPence += v;
            byType[a.type] = (byType[a.type] || 0) + v;
        }
        const totalLiabilitiesPence = liabilities.reduce((s, l) => s + Math.round(l.valuePence || 0), 0);
        return {
            assets,
            liabilities,
            byType,
            totalAssetsPence,
            totalLiabilitiesPence,
            netWorthPence: totalAssetsPence - totalLiabilitiesPence,
        };
    },

    // The assembled live Exit Plan (canonical GM `exitCalc` model): resolve the
    // group value today (live valuation midpoint, or a manual override), then run
    // the full plan — income gross-up across people, freehold rent offset, 4%-rule
    // pot, reverse-solved required sale, forward sale waterfall, and the 30-year
    // drawdown projection. Seeds currentValuePence into the inputs the screen
    // echoes back to /compute/exit-plan for live slider recompute.
    async exitPlan(orgId) {
        const { assets, liabilities, pensions, properties, exit } = await this.getInputs(orgId);

        // Group value today from the live valuation midpoint when asked; fall back
        // to the manual override on no baseline / error so the screen still computes.
        // valuation() seeds from the manual baseline first, else from REAL synced
        // turnover (invoice_items TTM) at the owner's assumed EBITDA margin.
        let currentValuePence = Math.round(exit.currentValuePence || 0);
        let valuationSource = 'manual';
        let valuationDetail = null;
        if (exit.useLiveValuation) {
            try {
                const v = await analytics_service_1.analyticsService.valuation(orgId, {
                    marginPct: exit.ebitdaMarginPct,
                });
                const mid = v && !v.error ? (v.midPoint ?? v.midpoint ?? 0) : 0;
                if (mid > 0) {
                    currentValuePence = Math.round(mid);
                    // 'live' = manual baseline; 'real-turnover' = seeded from Dentally turnover.
                    valuationSource = v.basis === 'real-turnover' ? 'real-turnover' : 'live';
                    valuationDetail = {
                        basis: v.basis ?? 'baseline',
                        annualRevenuePence: v.annualRevenuePence ?? null,
                        ebitdaMarginPct: v.ebitdaMarginPct ?? null,
                        ebitdaPence: v.ebitdaPence ?? null,
                        revenueMultiple: v.revenueMultiple ?? null,
                        revenueMultipleValuePence: v.revenueMultipleValuePence ?? null,
                    };
                }
            } catch {
                // keep the manual override
            }
        }

        // Seed existing investments from liquid (non-business) assets + pension
        // balances when the owner hasn't entered a manual figure — so the sale
        // waterfall stacks on top of what they already hold.
        const liquidAssetsPence = assets
            .filter((a) => a.liquid && a.type !== 'Business')
            .reduce((s, a) => s + Math.round(a.valuePence || 0), 0);
        const pensionPence = pensions.reduce((s, p) => s + Math.round(p.balancePence || 0), 0);
        const existingInvestPence = exit.existingInvestPence > 0
            ? Math.round(exit.existingInvestPence)
            : liquidAssetsPence + pensionPence;

        // Seed freeholds from buy-to-let / income properties when the owner hasn't
        // added any explicitly (value − mortgage = equity; annualised rent).
        const seededFreeholds = (exit.freeholds && exit.freeholds.length)
            ? exit.freeholds
            : properties
                .filter((p) => (p.monthlyIncomePence || 0) > 0 || p.type === 'Buy-to-let')
                .map((p) => ({
                    name: p.name || p.address || 'Property',
                    valuePence: Math.max(0, Math.round((p.valuePence || 0) - (p.mortgagePence || 0))),
                    rentPence: Math.round((p.monthlyIncomePence || 0) * 12),
                }));

        const resolved = {
            ...exit,
            currentValuePence,
            existingInvestPence,
            freeholds: seededFreeholds,
            baseYear: new Date().getFullYear(),
        };
        const plan = (0, formulas_1.calculateExitPlan)(resolved);

        return {
            valuation: { currentValuePence, source: valuationSource, detail: valuationDetail },
            plan,
            inputs: resolved,
            seeds: { liquidAssetsPence, pensionPence, existingInvestSeeded: !(exit.existingInvestPence > 0), freeholdsSeeded: !(exit.freeholds && exit.freeholds.length) },
        };
    },
};
