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
        // QuickBooks returns the company id as `realmId` on the callback query;
        // other OAuth providers only carry code + state. Forward it through.
        const { code, state, realmId, error: oauthError } = req.query;
        const dest = new URL(`${frontendUrl()}/integrations`);
        try {
            if (oauthError) throw new Error(String(oauthError));
            const { orgId } = verifyState(state, provider);
            await integration_service_1.integrationService.finishConnect(orgId, provider, { code, realmId });
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
    // On-demand data pull for a connected provider (Refresh button).
    // ?full=true re-pulls the full window (backfill after mapping practices).
    // Fire-and-forget: returns immediately; the UI polls /sync-progress for the
    // live percentage and the syncer stamps last_sync_at/last_error on the row.
    async sync(req, res) {
        const full = req.query.full === 'true' || req.body?.full === true;
        const { organisation_id } = req.user;
        const provider = req.params.provider;
        integration_service_1.integrationService.syncNow(organisation_id, provider, { full })
            .catch((err) => console.error(`[integrations] sync ${provider} failed:`, err?.message || err));
        res.json({ started: true, provider, full });
    },
    // Live progress of the running/last sync (in-memory). Polled by the UI bar.
    async syncProgress(req, res) {
        res.json(integration_service_1.integrationService.syncProgress(req.user.organisation_id, req.params.provider));
    },
    // Distinct Dentally site_ids (with counts) to drive practice mapping.
    async siteIds(req, res) {
        res.json(await integration_service_1.integrationService.detectSiteIds(req.user.organisation_id, req.params.provider));
    },
    // GoHighLevel pipelines + stages, to drive the stage-mapping UI.
    async pipelines(req, res) {
        res.json(await integration_service_1.integrationService.detectPipelines(req.user.organisation_id, req.params.provider));
    },
    // Persist the GHL stage -> Elevate status mapping.
    async setStageMappings(req, res) {
        res.json(await integration_service_1.integrationService.setStageMappings(req.user.organisation_id, req.params.provider, req.body?.mappings));
    },
    // Real-time webhook config (URL to paste into the provider + secret setter).
    async webhookInfo(req, res) {
        res.json(await integration_service_1.integrationService.webhookInfo(req.user.organisation_id, req.params.provider));
    },
    async setWebhookSecret(req, res) {
        res.json(await integration_service_1.integrationService.setWebhookSecret(req.user.organisation_id, req.params.provider, req.body?.secret));
    },
    async remove(req, res) {
        res.json(await integration_service_1.integrationService.remove(req.user.organisation_id, req.params.id));
    },
};
