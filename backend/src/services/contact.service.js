"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.contactService = void 0;
// ============================================================================
// Contact service — business logic for the contacts domain.
// Orchestrates the repository; throws AppError for client-visible failures.
// ============================================================================
const contact_repository_1 = require("../repositories/contact.repository");
const errors_1 = require("../middleware/errors");
exports.contactService = {
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
        const { data, error } = await contact_repository_1.contactRepository.create({
            organisation_id: orgId,
            ...input,
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
