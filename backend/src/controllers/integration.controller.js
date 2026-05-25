import * as integration_service_1 from "../services/integration.service.js";
import * as integration_model_1 from "../models/integration.model.js";
import { verifyState } from "../lib/oauth-state.js";

function frontendUrl() {
    return process.env.FRONTEND_URL || process.env.APP_URL || 'http://localhost:3000';
}

export const integrationController = {
    async list(req, res) {
        res.json(await integration_service_1.integrationService.list(req.user.organisation_id));
    },
    async connect(req, res) {
        const body = integration_model_1.integrationConnectSchema.parse(req.body);
        res.json(await integration_service_1.integrationService.startConnect(req.user.organisation_id, body.provider, body));
    },
    async callback(req, res) {
        const provider = req.params.provider;
        // OAuth providers carry { code, state } in query; broker uses POST body.
        const payload = req.method === 'POST' ? req.body : req.query;
        res.json(await integration_service_1.integrationService.finishConnect(req.user.organisation_id, provider, payload));
    },
    // PUBLIC OAuth callback. The provider redirects the browser here with no
    // JWT, so the org is recovered from the HMAC-signed `state` (not req.user).
    // Always redirects back to the frontend integrations page — never returns JSON.
    async oauthCallback(req, res) {
        const provider = req.params.provider;
        const { code, state, error: oauthError } = req.query;
        const dest = new URL(`${frontendUrl()}/integrations`);
        try {
            if (oauthError) throw new Error(String(oauthError));
            const { orgId } = verifyState(state, provider);
            await integration_service_1.integrationService.finishConnect(orgId, provider, { code });
            dest.searchParams.set('connected', provider);
        } catch (err) {
            dest.searchParams.set('error', err.message || 'oauth_failed');
            dest.searchParams.set('provider', provider);
        }
        res.redirect(dest.toString());
    },
    async revoke(req, res) {
        res.json(await integration_service_1.integrationService.revoke(req.user.organisation_id, req.params.provider));
    },
    async refresh(req, res) {
        res.json(await integration_service_1.integrationService.refresh(req.user.organisation_id, req.params.provider));
    },
    async remove(req, res) {
        res.json(await integration_service_1.integrationService.remove(req.user.organisation_id, req.params.id));
    },
};
