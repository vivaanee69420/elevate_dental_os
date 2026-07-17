// practice_cost_model business logic — lists the manual per-practice inputs
// as-of a date and writes edits, always at effective_from = today so the
// history is preserved (a rent rise in July must not rewrite March).
import { practiceCostModelRepository } from "../repositories/practice-cost-model.repository.js";
import { cockpitRepository } from "../repositories/cockpit.repository.js";

const today = () => new Date().toISOString().slice(0, 10);

// camelCase API field -> snake_case column. Only supplied keys are mapped, so a
// partial edit never nulls the fields it didn't mention.
const FIELD_MAP = {
    fixedCostPenceMonth: 'fixed_cost_pence_month',
    breakevenLowPence: 'breakeven_low_pence',
    breakevenHighPence: 'breakeven_high_pence',
    workingDaysPerMonth: 'working_days_per_month',
    revenueTargetPenceMonth: 'revenue_target_pence_month',
};

function shape(practice, model) {
    return {
        practiceId: practice.id,
        name: practice.name,
        // null (not today) when the practice has no model at all — the UI
        // renders "Not set", never a fabricated £0.
        effectiveFrom: model?.effective_from ?? null,
        fixedCostPenceMonth: model?.fixed_cost_pence_month ?? null,
        breakevenLowPence: model?.breakeven_low_pence ?? null,
        breakevenHighPence: model?.breakeven_high_pence ?? null,
        workingDaysPerMonth: model?.working_days_per_month ?? 20,
        revenueTargetPenceMonth: model?.revenue_target_pence_month ?? null,
    };
}

export const practiceCostModelService = {
    async list(orgId, { asOf, practiceId } = {}) {
        const on = asOf || today();
        const [practices, models] = await Promise.all([
            cockpitRepository.activePractices(orgId, practiceId),
            practiceCostModelRepository.asOf(orgId, on),
        ]);
        const byPractice = new Map((models || []).map(m => [m.practice_id, m]));
        return { asOf: on, rows: (practices || []).map(p => shape(p, byPractice.get(p.id))) };
    },

    async save(orgId, practiceId, input) {
        // The practice must belong to the caller's org. activePractices is
        // org-filtered, so an id from another tenant simply isn't in the list.
        const practices = await cockpitRepository.activePractices(orgId, practiceId);
        const practice = (practices || []).find(p => p.id === practiceId);
        if (!practice) throw new Error('practice not found');

        const fields = {};
        for (const [key, col] of Object.entries(FIELD_MAP)) {
            if (input[key] !== undefined) fields[col] = input[key];
        }

        const row = await practiceCostModelRepository.upsert(orgId, practiceId, today(), fields);
        return shape(practice, row);
    },
};
