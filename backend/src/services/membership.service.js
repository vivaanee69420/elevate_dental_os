// ============================================================================
// Membership service — business logic for the memberships domain.
// ============================================================================
import * as membership_repository_1 from "../repositories/membership.repository.js";
import * as errors_1 from "../middleware/errors.js";
export const membershipService = {
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
