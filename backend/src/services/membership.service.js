// ============================================================================
// Membership service — business logic for the memberships domain.
// ============================================================================
import * as membership_repository_1 from "../repositories/membership.repository.js";
import * as errors_1 from "../middleware/errors.js";
import { assertOrgOwns } from "../lib/tenant-guard.js";
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
        // Memberships embed contact + plan on read; a foreign plan_id would
        // disclose another org's plan names and pricing.
        await assertOrgOwns(orgId, 'contacts', input.contact_id, 'Contact');
        await assertOrgOwns(orgId, 'membership_plans', input.plan_id, 'Plan');
        const { data, error } = await membership_repository_1.membershipRepository.create({
            ...input,
            organisation_id: orgId,
        });
        if (error)
            throw new errors_1.AppError(error.message, 400);
        return data;
    },
};
