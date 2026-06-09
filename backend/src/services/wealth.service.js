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

// Defaults a never-configured org reads (mirror wealth.model.js schema defaults
// so the UI gets a full, stable shape without a saved row).
const EMPTY_FIRE = {
    targetAnnualSpendPence: 0, withdrawalRatePct: 4, growthRatePct: 7,
    annualSavingsPence: 0, horizonYears: 10,
};
const EMPTY_SALE = {
    ownerSharePct: 100, businessDebtPence: 0, freeholdEquityPence: 0,
    acquisitionCostPence: 0, badrLifetimeUsedPence: 0, useLiveValuation: true,
    enterpriseValuePence: 0,
};

export const wealthService = {
    // Saved personal-wealth inputs in the camelCase shape the screens consume,
    // or sane empties when never configured.
    async getInputs(orgId) {
        const row = await wealth_repository_1.wealthRepository.get(orgId);
        return {
            assets: row?.assets ?? [],
            liabilities: row?.liabilities ?? [],
            pensions: row?.pensions ?? [],
            properties: row?.properties ?? [],
            fire: { ...EMPTY_FIRE, ...(row?.fire ?? {}) },
            sale: { ...EMPTY_SALE, ...(row?.sale ?? {}) },
            updatedAt: row?.updated_at ?? null,
        };
    },

    // Persist the validated blob (wealthInputsSchema output) then read it back.
    async saveInputs(orgId, inputs, userId) {
        await wealth_repository_1.wealthRepository.upsert(orgId, {
            assets: inputs.assets,
            liabilities: inputs.liabilities,
            pensions: inputs.pensions,
            properties: inputs.properties,
            fire: inputs.fire,
            sale: inputs.sale,
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

    // The assembled live Exit Plan: resolve the business EV (live valuation
    // midpoint, or a manual override), run the sale waterfall for net cash, then
    // the FIRE projection using liquid assets + that net cash − liabilities.
    // Business-type assets are excluded from the liquid pool to avoid double-
    // counting the business (its realisable value comes from the waterfall).
    async exitPlan(orgId) {
        const { assets, liabilities, fire, sale } = await this.getInputs(orgId);

        // EV from the live valuation midpoint when asked; fall back to the manual
        // override on no baseline / error so the screen still computes.
        let enterpriseValuePence = Math.round(sale.enterpriseValuePence || 0);
        let valuationSource = 'manual';
        if (sale.useLiveValuation) {
            try {
                const v = await analytics_service_1.analyticsService.valuation(orgId);
                if (v && !v.error && v.midpoint > 0) {
                    enterpriseValuePence = Math.round(v.midpoint);
                    valuationSource = 'live';
                }
            } catch {
                // keep the manual override
            }
        }

        const waterfall = (0, formulas_1.calculateSaleWaterfall)({
            enterpriseValuePence,
            businessDebtPence: sale.businessDebtPence,
            ownerSharePct: sale.ownerSharePct,
            acquisitionCostPence: sale.acquisitionCostPence,
            freeholdEquityPence: sale.freeholdEquityPence,
            badrLifetimeUsedPence: sale.badrLifetimeUsedPence,
        });

        const liquidAssetsPence = assets
            .filter((a) => a.liquid && a.type !== 'Business')
            .reduce((s, a) => s + Math.round(a.valuePence || 0), 0);
        const liabilitiesPence = liabilities.reduce((s, l) => s + Math.round(l.valuePence || 0), 0);

        const plan = (0, formulas_1.calculateFirePlan)({
            liquidAssetsPence,
            liabilitiesPence,
            businessNetProceedsPence: waterfall.totalNetProceedsPence,
            targetAnnualSpendPence: fire.targetAnnualSpendPence,
            withdrawalRatePct: fire.withdrawalRatePct,
            growthRatePct: fire.growthRatePct,
            annualSavingsPence: fire.annualSavingsPence,
            horizonYears: fire.horizonYears,
        });

        return {
            valuation: { enterpriseValuePence, source: valuationSource },
            waterfall,
            fire: plan,
            inputs: { liquidAssetsPence, liabilitiesPence, fire, sale },
        };
    },
};
