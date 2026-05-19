// ============================================================================
// Integration service — business logic for the integrations domain.
// ============================================================================
import * as integration_repository_1 from "../repositories/integration.repository.js";
export const integrationService = {
    async list(orgId) {
        const data = await integration_repository_1.integrationRepository.list(orgId);
        return { integrations: data || [] };
    },
    connect(orgId, input) {
        // Return OAuth URL for the provider
        // (Each provider needs custom OAuth flow)
        return { auth_url: `/oauth/${input.provider}/start?org=${orgId}` };
    },
    async remove(orgId, id) {
        await integration_repository_1.integrationRepository.remove(orgId, id);
        return { success: true };
    },
};
