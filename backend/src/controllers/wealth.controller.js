// ============================================================================
// Wealth controller — personal-wealth Exit Plan / FIRE (DentaCFO gap Phase 4).
// Parse/validate with the Zod schemas, call the service, shape the response.
// No business logic.
// ============================================================================
import * as wealth_service_1 from "../services/wealth.service.js";
import * as wealth_model_1 from "../models/wealth.model.js";

export const wealthController = {
    async getInputs(req, res) {
        res.json(await wealth_service_1.wealthService.getInputs(req.user.organisation_id));
    },
    async saveInputs(req, res) {
        const inputs = wealth_model_1.wealthInputsSchema.parse(req.body);
        res.json(await wealth_service_1.wealthService.saveInputs(req.user.organisation_id, inputs, req.user.id));
    },
    async exitPlan(req, res) {
        res.json(await wealth_service_1.wealthService.exitPlan(req.user.organisation_id));
    },
    // Saved-plan snapshot vs the live re-resolved plan (drift since last save).
    async exitPlanCompare(req, res) {
        res.json(await wealth_service_1.wealthService.exitPlanCompare(req.user.organisation_id));
    },
    async netWorth(req, res) {
        res.json(await wealth_service_1.wealthService.netWorth(req.user.organisation_id));
    },
    // Pure /compute recompute (slider-driven, audit-exempt).
    saleWaterfall(req, res) {
        const body = wealth_model_1.saleWaterfallSchema.parse(req.body);
        res.json(wealth_service_1.wealthService.computeSaleWaterfall(body));
    },
    firePlan(req, res) {
        const body = wealth_model_1.firePlanSchema.parse(req.body);
        res.json(wealth_service_1.wealthService.computeFirePlan(body));
    },
    // Canonical Exit Plan slider recompute (audit-exempt).
    exitPlanCompute(req, res) {
        const body = wealth_model_1.exitPlanComputeSchema.parse(req.body);
        res.json(wealth_service_1.wealthService.computeExitPlan(body));
    },
};
