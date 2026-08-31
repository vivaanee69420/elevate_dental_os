// ============================================================================
// Contact service — business logic for the contacts domain.
// Orchestrates the repository; throws AppError for client-visible failures.
// ============================================================================
import * as contact_repository_1 from "../repositories/contact.repository.js";
import * as errors_1 from "../middleware/errors.js";
import { assertOrgOwns } from "../lib/tenant-guard.js";
export const contactService = {
    list(orgId, q) {
        return contact_repository_1.contactRepository.list(orgId, q);
    },
    async getById(orgId, id) {
        const { data, error } = await contact_repository_1.contactRepository.getById(orgId, id);
        if (error)
            throw new errors_1.AppError('Not found', 404);
        return data;
    },
    async create(orgId, input) {
        // Contacts embed `practice:practices(id, name)` on read.
        await assertOrgOwns(orgId, 'practices', input.practice_id, 'Practice');
        const { data, error } = await contact_repository_1.contactRepository.create({
            ...input,
            organisation_id: orgId,
        });
        if (error)
            throw new errors_1.AppError(error.message, 400);
        return data;
    },
    async update(orgId, id, patch) {
        const { data, error } = await contact_repository_1.contactRepository.update(orgId, id, patch);
        if (error)
            throw new errors_1.AppError(error.message, 400);
        return data;
    },
};
