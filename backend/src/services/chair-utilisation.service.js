// ============================================================================
// Chair utilisation service — CRUD + heatmap grid aggregation.
// ============================================================================
import { chairUtilisationRepository } from "../repositories/chair-utilisation.repository.js";
import { aggregateGrid } from "../lib/chair-utilisation.js";
import * as errors_1 from "../middleware/errors.js";

export const chairUtilisationService = {
    list(orgId, practiceId) {
        return chairUtilisationRepository.list(orgId, practiceId);
    },

    async grid(orgId, practiceId) {
        const records = await chairUtilisationRepository.list(orgId, practiceId);
        return aggregateGrid(records);
    },

    async create(orgId, input) {
        const { data, error } = await chairUtilisationRepository.create({
            organisation_id: orgId,
            ...input,
        });
        if (error) throw new errors_1.AppError(error.message, 400);
        return data;
    },

    async update(orgId, id, patch) {
        const { data, error } = await chairUtilisationRepository.update(orgId, id, patch);
        if (error) throw new errors_1.AppError(error.message, 400);
        if (!data) throw new errors_1.AppError('Record not found', 404);
        return data;
    },

    async remove(orgId, id) {
        const { data, error } = await chairUtilisationRepository.remove(orgId, id);
        if (error) throw new errors_1.AppError(error.message, 400);
        if (!data) throw new errors_1.AppError('Record not found', 404);
        return { ok: true };
    },
};
