// ============================================================================
// Workflow service — business logic for the workflows domain.
// ============================================================================
import * as workflow_repository_1 from "../repositories/workflow.repository.js";
import * as errors_1 from "../middleware/errors.js";
export const workflowService = {
    async list(orgId) {
        const data = await workflow_repository_1.workflowRepository.list(orgId);
        return { workflows: data || [] };
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
