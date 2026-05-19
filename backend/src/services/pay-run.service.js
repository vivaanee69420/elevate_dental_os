// ============================================================================
// Pay-run service — business logic for the pay-runs domain.
// ============================================================================
import * as pay_run_repository_1 from "../repositories/pay-run.repository.js";
import * as errors_1 from "../middleware/errors.js";
import * as formulas_1 from "../lib/formulas.js";
export const payRunService = {
    async list(orgId) {
        const data = await pay_run_repository_1.payRunRepository.list(orgId);
        return { pay_runs: data || [] };
    },
    async calculate(orgId, input) {
        // Fetch associates to get their pay rates
        const associates = await pay_run_repository_1.payRunRepository.listAssociates(orgId);
        const associatesMap = new Map((associates || []).map(a => [a.id, a]));
        // Create pay run
        const { data: payRun, error } = await pay_run_repository_1.payRunRepository.createPayRun({
            organisation_id: orgId,
            period_start: input.period_start,
            period_end: input.period_end,
            status: 'draft',
        });
        if (error)
            throw new errors_1.AppError(error.message, 400);
        // Calculate lines
        const lines = input.lines.map(line => {
            const assoc = associatesMap.get(line.associate_id);
            if (!assoc)
                throw new Error(`Associate ${line.associate_id} not found`);
            const calc = (0, formulas_1.calculateAssociatePay)({
                productionPence: line.production_pence,
                labCostPence: line.lab_cost_pence,
                payPct: assoc.pay_pct,
                labSplitPct: assoc.lab_split_pct,
                prevBalancePence: line.prev_balance_pence,
            });
            return {
                pay_run_id: payRun.id,
                organisation_id: orgId,
                associate_id: line.associate_id,
                production_pence: line.production_pence,
                lab_cost_pence: line.lab_cost_pence,
                gross_pence: calc.grossPence,
                lab_deduction_pence: calc.labDeductionPence,
                prev_balance_pence: calc.prevBalancePence,
                net_pence: calc.netPence,
            };
        });
        await pay_run_repository_1.payRunRepository.insertLines(lines);
        // Update totals
        const totals = lines.reduce((acc, l) => ({
            gross: acc.gross + l.gross_pence,
            lab: acc.lab + l.lab_deduction_pence,
            net: acc.net + l.net_pence,
        }), { gross: 0, lab: 0, net: 0 });
        await pay_run_repository_1.payRunRepository.updateTotals(payRun.id, {
            total_gross_pence: totals.gross,
            total_lab_deductions_pence: totals.lab,
            total_net_pence: totals.net,
        });
        return { pay_run_id: payRun.id, totals, lines };
    },
    async approve(orgId, id, approvedBy) {
        const { error } = await pay_run_repository_1.payRunRepository.approve(orgId, id, {
            status: 'approved',
            approved_by: approvedBy,
            approved_at: new Date().toISOString(),
        });
        if (error)
            throw new errors_1.AppError(error.message, 400);
        return { success: true };
    },
};
