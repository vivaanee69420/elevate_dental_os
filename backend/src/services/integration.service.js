// ============================================================================
// Integration service — wires per-provider IntegrationProvider impls into
// the 5-layer architecture. Owner-only RBAC checked at route level.
// ============================================================================
import * as integration_repository_1 from "../repositories/integration.repository.js";
import "../lib/integrations/index.js";
import { getProvider, listProviders } from "../lib/integrations/provider-interface.js";
import * as errors_1 from "../middleware/errors.js";

export const integrationService = {
    async list(orgId) {
        const connected = await integration_repository_1.integrationRepository.list(orgId);
        const available = listProviders();
        return { integrations: connected, available };
    },
    async startConnect(orgId, provider, extra = {}) {
        const { impl } = getProvider(provider);
        try {
            return await impl.authorize(orgId, extra);
        } catch (err) {
            // A provider that isn't configured on this server (missing
            // CLIENT_ID/SECRET or OAUTH_STATE_SECRET) is an operator/config
            // problem, not a server crash. Surface a clear 501 so the UI shows
            // "not configured" instead of an opaque 500.
            const msg = err.message || 'Connect failed';
            if (/not configured|env vars missing|OAUTH_STATE_SECRET/i.test(msg)) {
                throw new errors_1.AppError(`${provider} is not configured on this server. ${msg}`, 501);
            }
            throw err;
        }
    },
    async finishConnect(orgId, provider, payload) {
        const { impl } = getProvider(provider);
        try {
            const result = await impl.callback(orgId, payload);
            return { ok: true, ...result };
        } catch (err) {
            throw new errors_1.AppError(err.message || 'Connect failed', 400);
        }
    },
    async revoke(orgId, provider) {
        const { impl } = getProvider(provider);
        return impl.revoke(orgId);
    },
    async refresh(orgId, provider) {
        const { impl } = getProvider(provider);
        return impl.refresh(orgId);
    },
    async remove(orgId, id) {
        await integration_repository_1.integrationRepository.remove(orgId, id);
        return { ok: true };
    },
    // Back-compat shim for the original connect() signature.
    connect(orgId, input) {
        return this.startConnect(orgId, input.provider);
    },
};
