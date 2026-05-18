"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.membershipService = void 0;
// ============================================================================
// Membership service — business logic for the memberships domain.
// ============================================================================
const membership_repository_1 = require("../repositories/membership.repository");
const errors_1 = require("../middleware/errors");
exports.membershipService = {
    async listPlans(orgId) {
        const data = await membership_repository_1.membershipRepository.listPlans(orgId);
        return { plans: data || [] };
    },
    async list(orgId) {
        const data = await membership_repository_1.membershipRepository.list(orgId);
        return { memberships: data || [] };
    },
    async create(orgId, input) {
        const { data, error } = await membership_repository_1.membershipRepository.create({
            organisation_id: orgId,
            ...input,
        });
        if (error)
            throw new errors_1.AppError(error.message, 400);
        return data;
    },
};
