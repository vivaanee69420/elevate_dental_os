"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.workflowService = void 0;
// ============================================================================
// Workflow service — business logic for the workflows domain.
// ============================================================================
const workflow_repository_1 = require("../repositories/workflow.repository");
const errors_1 = require("../middleware/errors");
exports.workflowService = {
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
