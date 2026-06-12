import * as integration_service_1 from "../services/integration.service.js";
import * as integration_model_1 from "../models/integration.model.js";
import { providerParamSchema, idParamSchema } from "../models/common.model.js";
import { verifyState } from "../lib/oauth-state.js";
import { ghlAccountService } from "../services/ghl-account.service.js";
import { syncAccount, detectPipelinesForToken } from "../lib/integrations/gohighlevel-sync.js";
import { integrationAccountRepository } from "../repositories/integration-account.repository.js";
import { decryptSecret } from "../lib/crypto.js";
import { ghlAccountCreateSchema, ghlAccountUpdateSchema, ghlDashboardQuerySchema } from "../models/integration.model.js";
import { ghlDashboardService } from "../services/ghl-dashboard.service.js";

function frontendUrl() {
    const raw = (process.env.FRONTEND_URL || process.env.APP_URL || 'http://localhost:3000').trim();
    // Guarantee an absolute URL with a scheme. A bare host (e.g.
    // "app.elevate.app") makes `new URL()` throw "Invalid URL", which 500s the
    // OAuth callback at line 32 BEFORE the token is ever persisted — losing the
    // one-time auth code. Prepend https:// when no scheme is present, and fall
    // back to localhost if the value is still unparseable.
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    try {
        return new URL(withScheme).origin;
    } catch {
        return 'http://localhost:3000';
    }
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
        const { provider } = providerParamSchema.parse(req.params);
        // OAuth providers carry { code, state } in query; broker uses POST body.
        const payload = req.method === 'POST' ? req.body : req.query;
        res.json(await integration_service_1.integrationService.finishConnect(req.user.organisation_id, provider, payload));
    },
    // PUBLIC OAuth callback. The provider redirects the browser here with no
    // JWT, so the org is recovered from the HMAC-signed `state` (not req.user).
    // Always redirects back to the frontend integrations page — never returns JSON.
    async oauthCallback(req, res) {
        // Public redirect slug aliases: GHL's marketplace blocks a redirect URI
        // containing "highlevel"/"ghl", so its callback is registered under
        // `leadconnector`. Map it back to the internal provider key (which is
        // also what the signed OAuth state carries).
        const PROVIDER_ALIAS = { leadconnector: 'gohighlevel' };
        const provider = PROVIDER_ALIAS[req.params.provider] || req.params.provider;
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
        const { provider } = providerParamSchema.parse(req.params);
        res.json(await integration_service_1.integrationService.revoke(req.user.organisation_id, provider));
    },
    async refresh(req, res) {
        const { provider } = providerParamSchema.parse(req.params);
        res.json(await integration_service_1.integrationService.refresh(req.user.organisation_id, provider));
    },
    // On-demand data pull for a connected provider (Refresh button).
    // ?full=true re-pulls the full window (backfill after mapping practices).
    // Fire-and-forget: returns immediately; the UI polls /sync-progress for the
    // live percentage and the syncer stamps last_sync_at/last_error on the row.
    async sync(req, res) {
        const { provider } = providerParamSchema.parse(req.params);
        const { full: bodyFull, resources } = integration_model_1.syncBodySchema.parse(req.body ?? {});
        const full = req.query.full === 'true' || bodyFull === true;
        const { organisation_id } = req.user;
        integration_service_1.integrationService.syncNow(organisation_id, provider, { full, resources: resources ?? null })
            .catch((err) => console.error(`[integrations] sync ${provider} failed:`, err?.message || err));
        res.json({ started: true, provider, full, resources: resources ?? null });
    },
    // Global "Refresh all" — fire an incremental pull for every connected
    // provider (Dentally, GHL, Google/Meta Ads, QuickBooks). Fire-and-forget:
    // returns the providers that started; the UI polls per-provider progress.
    async syncAll(req, res) {
        const { started } = await integration_service_1.integrationService.syncAll(req.user.organisation_id);
        res.json({ started });
    },
    // Live progress of the running/last sync (in-memory). Polled by the UI bar.
    async syncProgress(req, res) {
        const { provider } = providerParamSchema.parse(req.params);
        res.json(integration_service_1.integrationService.syncProgress(req.user.organisation_id, provider));
    },
    // Distinct Dentally site_ids (with counts) to drive practice mapping.
    async siteIds(req, res) {
        const { provider } = providerParamSchema.parse(req.params);
        res.json(await integration_service_1.integrationService.detectSiteIds(req.user.organisation_id, provider));
    },
    // GoHighLevel pipelines + stages, to drive the stage-mapping UI.
    async pipelines(req, res) {
        const { provider } = providerParamSchema.parse(req.params);
        res.json(await integration_service_1.integrationService.detectPipelines(req.user.organisation_id, provider));
    },
    // Persist the GHL stage -> Elevate status mapping.
    async setStageMappings(req, res) {
        const { provider } = providerParamSchema.parse(req.params);
        const { mappings } = integration_model_1.stageMappingsSchema.parse(req.body);
        res.json(await integration_service_1.integrationService.setStageMappings(req.user.organisation_id, provider, mappings));
    },
    // Real-time webhook config (URL to paste into the provider + secret setter).
    async webhookInfo(req, res) {
        const { provider } = providerParamSchema.parse(req.params);
        res.json(await integration_service_1.integrationService.webhookInfo(req.user.organisation_id, provider));
    },
    async setWebhookSecret(req, res) {
        const { provider } = providerParamSchema.parse(req.params);
        const { secret } = integration_model_1.webhookSecretSchema.parse(req.body);
        res.json(await integration_service_1.integrationService.setWebhookSecret(req.user.organisation_id, provider, secret));
    },
    // Ad accounts (Google/Meta) for the selector + selection persistence.
    async adAccounts(req, res) {
        const { provider } = providerParamSchema.parse(req.params);
        res.json(await integration_service_1.integrationService.adAccounts(req.user.organisation_id, provider));
    },
    async setAdAccountSelection(req, res) {
        const { provider } = providerParamSchema.parse(req.params);
        const { selected_ids } = integration_model_1.adAccountSelectionSchema.parse(req.body);
        res.json(await integration_service_1.integrationService.setAdAccountSelection(req.user.organisation_id, provider, selected_ids));
    },
    async remove(req, res) {
        const { id } = idParamSchema.parse(req.params);
        res.json(await integration_service_1.integrationService.remove(req.user.organisation_id, id));
    },
    // --- GoHighLevel subaccounts -------------------------------------------
    async ghlAccountsList(req, res) {
        res.json(await ghlAccountService.listAccounts(req.user.organisation_id));
    },
    async ghlAccountCreate(req, res) {
        const body = ghlAccountCreateSchema.parse(req.body);
        res.json(await ghlAccountService.addAccount(req.user.organisation_id, body));
    },
    async ghlAccountUpdate(req, res) {
        const { id } = idParamSchema.parse(req.params);
        const body = ghlAccountUpdateSchema.parse(req.body);
        res.json(await ghlAccountService.updateAccount(req.user.organisation_id, id, body));
    },
    async ghlAccountRemove(req, res) {
        const { id } = idParamSchema.parse(req.params);
        res.json(await ghlAccountService.removeAccount(req.user.organisation_id, id));
    },
    async ghlAccountSync(req, res) {
        const { id } = idParamSchema.parse(req.params);
        const orgId = req.user.organisation_id;
        const full = req.query.full === 'true';
        syncAccount(orgId, id, () => {}, { full })
            .catch((err) => console.error('[ghl-account] sync failed:', err?.message || err));
        res.json({ started: true, accountId: id, full });
    },
    async ghlAccountPipelines(req, res) {
        const { id } = idParamSchema.parse(req.params);
        const orgId = req.user.organisation_id;
        const acc = await integrationAccountRepository.getByIdWithSecrets(orgId, id);
        if (!acc || !acc.secrets) { res.json({ pipelines: [], error: 'no_auth' }); return; }
        const { access_token } = JSON.parse(decryptSecret(acc.secrets));
        res.json(await detectPipelinesForToken(access_token, acc.external_account_id));
    },
    async ghlAccountStageMappings(req, res) {
        const { id } = idParamSchema.parse(req.params);
        const { mappings } = integration_model_1.stageMappingsSchema.parse(req.body);
        const orgId = req.user.organisation_id;
        await integrationAccountRepository.mergeConfig(orgId, id, { stage_mappings: mappings });
        res.json({ ok: true, stage_mappings: mappings });
    },
    async ghlDashboard(req, res) {
        const q = ghlDashboardQuerySchema.parse(req.query);
        // Default to the trailing 30 days (day-granular, UTC) when no window given.
        const now = new Date();
        const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
        const since = q.since ?? new Date(todayMs - 29 * 86_400_000).toISOString();
        const until = q.until ?? new Date(todayMs + 86_400_000).toISOString();
        res.json(await ghlDashboardService.getDashboard(req.user.organisation_id, {
            since, until,
            accountId: q.accountId ?? null,
            practiceId: q.practiceId ?? null,
        }));
    },
};
