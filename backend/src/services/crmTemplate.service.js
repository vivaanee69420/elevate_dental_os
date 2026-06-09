// ============================================================================
// CRM template service — business logic for the templates domain.
// ============================================================================
import * as crmTemplate_repository_1 from "../repositories/crmTemplate.repository.js";
import * as errors_1 from "../middleware/errors.js";

export const crmTemplateService = {
    async list(orgId, query = {}) {
        const data = await crmTemplate_repository_1.crmTemplateRepository.list(orgId, query);
        return { templates: data || [] };
    },
    async create(orgId, userId, input) {
        const { data, error } = await crmTemplate_repository_1.crmTemplateRepository.create({
            organisation_id: orgId,
            created_by: userId,
            ...input,
        });
        if (error) throw new errors_1.AppError(error.message, 400);
        return data;
    },
    async update(orgId, id, patch) {
        const { data, error } = await crmTemplate_repository_1.crmTemplateRepository.update(orgId, id, patch);
        if (error) throw new errors_1.AppError(error.message, 400);
        return data;
    },
    async remove(orgId, id) {
        const { error } = await crmTemplate_repository_1.crmTemplateRepository.archive(orgId, id);
        if (error) throw new errors_1.AppError(error.message, 400);
        return { success: true };
    },
};
