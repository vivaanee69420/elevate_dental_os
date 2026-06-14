// ============================================================================
// Workflow service — business logic for the workflows domain.
// ============================================================================
import * as workflow_repository_1 from "../repositories/workflow.repository.js";
import * as errors_1 from "../middleware/errors.js";
import { integrationRepository } from "../repositories/integration.repository.js";
import { integrationAccountRepository } from "../repositories/integration-account.repository.js";
export const workflowService = {
    async list(orgId) {
        const data = await workflow_repository_1.workflowRepository.list(orgId);
        return { workflows: data || [] };
    },
    // GoHighLevel automations (workflows) cached on the integration config by the
    // sync. GHL exposes id/name/status only (no per-workflow sent/conversion).
    async ghl(orgId, { practiceId = null, accountId = null } = {}) {
        const accounts = await integrationAccountRepository.list(orgId, 'gohighlevel');
        let targetAccounts = accounts;
        if (accountId) {
            targetAccounts = accounts.filter(a => a.id === accountId);
        } else if (practiceId) {
            targetAccounts = accounts.filter(a => a.practice_id === practiceId);
        }
        const allWorkflows = [];
        for (const a of targetAccounts) {
            const workflows = a.config?.workflows ?? [];
            for (const w of workflows) {
                allWorkflows.push({
                    ...w,
                    accountLabel: a.label || 'GoHighLevel',
                    accountId: a.id,
                });
            }
        }
        if (!accountId && !practiceId) {
            const integration = await integrationRepository.getByProvider(orgId, 'gohighlevel');
            const legacyWorkflows = integration?.config?.workflows ?? [];
            for (const w of legacyWorkflows) {
                if (!allWorkflows.some(aw => aw.id === w.id)) {
                    allWorkflows.push({
                        ...w,
                        accountLabel: 'Legacy Connection',
                        accountId: null,
                    });
                }
            }
        }
        return { workflows: allWorkflows };
    },
    async create(orgId, input) {
        const { data, error } = await workflow_repository_1.workflowRepository.create({
            organisation_id: orgId,
            ...input,
        });
        if (error)
            throw new errors_1.AppError(error.message, 400);
        return data;
    },
    async update(orgId, id, patch) {
        const { data, error } = await workflow_repository_1.workflowRepository.update(orgId, id, patch);
        if (error)
            throw new errors_1.AppError(error.message, 400);
        return data;
    },
    async remove(orgId, id) {
        const { error } = await workflow_repository_1.workflowRepository.remove(orgId, id);
        if (error)
            throw new errors_1.AppError(error.message, 400);
        return { success: true };
    },
};
