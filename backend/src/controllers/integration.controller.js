import * as integration_service_1 from "../services/integration.service.js";
import * as integration_model_1 from "../models/integration.model.js";
import { providerParamSchema, idParamSchema } from "../models/common.model.js";
import { verifyState } from "../lib/oauth-state.js";
import { ghlAccountService } from "../services/ghl-account.service.js";
import { quickbooksAccountService } from "../services/quickbooks-account.service.js";
import { syncAccount, detectPipelinesForToken } from "../lib/integrations/gohighlevel-sync.js";
import { integrationAccountRepository } from "../repositories/integration-account.repository.js";
import { decryptSecret } from "../lib/crypto.js";
import { ghlAccountCreateSchema, ghlAccountUpdateSchema, ghlDashboardQuerySchema, callrailAccountCreateSchema, callrailAccountUpdateSchema, callrailDiscoverSchema, callrailBulkConnectSchema } from "../models/integration.model.js";
import { isAgencyActor } from "../middleware/agency.js";
import { ghlDashboardService } from "../services/ghl-dashboard.service.js";
import { emergentService } from "../services/emergent.service.js";
import { featuresService } from "../services/features.service.js";
import { callrailService } from "../services/callrail.service.js";

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
    // ---- Emergent (Treatments Accepted) — connect + pull --------------------
    async emergentGet(req, res) {
        res.json(await emergentService.get(req.user.organisation_id));
    },
    async emergentConnect(req, res) {
        const { baseUrl, apiKey } = req.body ?? {};
        res.json(await emergentService.connect(req.user.organisation_id, { baseUrl, apiKey }));
    },
    async emergentSync(req, res) {
        const full = req.body?.full === true || req.query?.full === 'true';
        res.json(await emergentService.sync(req.user.organisation_id, { full }));
    },
    async dentallyRepairPayments(req, res) {
        const body = integration_model_1.dentallyPaymentRepairSchema.parse(req.body);
        res.json(await integration_service_1.integrationService.repairDentallyPayments(
            req.user.organisation_id, { since: body.since, until: body.until },
        ));
    },
    async emergentDisconnect(req, res) {
        res.json(await emergentService.disconnect(req.user.organisation_id));
    },
    async emergentPractices(req, res) {
        res.json(await emergentService.listPractices(req.user.organisation_id));
    },
    async emergentSetPractice(req, res) {
        const body = integration_model_1.emergentPracticeMapSchema.parse(req.body);
        res.json(await emergentService.setPracticeMapping(req.user.organisation_id, {
            businessId: body.business_id,
            practiceId: body.practice_id,
        }));
    },
    // ---- CallRail (multi-company call tracking) — provider-level status/
    // sync/disconnect (Task 3), plus the per-company /accounts routes below
    // (Task 4). callrailGet now reads the real per-company rows + source
    // breakdown via callrail.service.js rather than the Task-3-era stub.
    async callrailGet(req, res) {
        res.json(await callrailService.status(req.user.organisation_id));
    },
    async callrailSync(req, res) {
        res.json(await integration_service_1.integrationService.callrailSync(req.user.organisation_id));
    },
    async callrailDisconnect(req, res) {
        res.json(await integration_service_1.integrationService.callrailDisconnect(req.user.organisation_id));
    },
    // --- CallRail companies --------------------------------------------------
    // Add-company step 1 (key-only discovery): ONE API key reveals every
    // account and company it can reach — no account id typed by hand. POST,
    // not GET+query, deliberately — the API key never belongs in a URL/query
    // string (logs, browser history, proxies). Ungated beyond the standard
    // requireRole on the route: this never persists anything, so there is
    // nothing for the agency-actor check to protect.
    async callrailDiscover(req, res) {
        const body = callrailDiscoverSchema.parse(req.body);
        res.json(await callrailService.discoverAccounts(req.user.organisation_id, body));
    },
    // Add-company step 2: connect several discovered companies in one request.
    // practiceId is the agency-controlled mapping field on EACH entry, same
    // rule as callrailAccountCreate/ghlAccountUpdate — a non-agency owner may
    // still connect companies, just unmapped, so the whole request 403s only
    // when at least one entry actually carries a practiceId key.
    async callrailBulkConnect(req, res) {
        const entries = Array.isArray(req.body?.companies) ? req.body.companies : [];
        const wantsMapping = entries.some((c) => c && c.practiceId !== undefined);
        if (wantsMapping && !(await isAgencyActor(req))) {
            return res.status(403).json({ error: 'Agency access required', code: 'AGENCY_ONLY' });
        }
        const body = callrailBulkConnectSchema.parse(req.body);
        res.json(await callrailService.bulkConnect(req.user.organisation_id, body));
    },
    async callrailAccountCreate(req, res) {
        // practiceId is the agency-controlled mapping field, same rule as
        // ghlAccountUpdate's practice_id — a non-agency owner may still add
        // an unmapped company, just not choose its practice.
        if (req.body?.practiceId !== undefined && !(await isAgencyActor(req))) {
            return res.status(403).json({ error: 'Agency access required', code: 'AGENCY_ONLY' });
        }
        const body = callrailAccountCreateSchema.parse(req.body);
        res.json(await callrailService.addAccount(req.user.organisation_id, body));
    },
    async callrailAccountUpdate(req, res) {
        if (req.body?.practiceId !== undefined && !(await isAgencyActor(req))) {
            return res.status(403).json({ error: 'Agency access required', code: 'AGENCY_ONLY' });
        }
        const { id } = idParamSchema.parse(req.params);
        const body = callrailAccountUpdateSchema.parse(req.body);
        res.json(await callrailService.updateAccount(req.user.organisation_id, id, body));
    },
    async callrailAccountRemove(req, res) {
        const { id } = idParamSchema.parse(req.params);
        res.json(await callrailService.removeAccount(req.user.organisation_id, id));
    },
    async callrailAccountSync(req, res) {
        const { id } = idParamSchema.parse(req.params);
        res.json(await callrailService.syncAccount(req.user.organisation_id, id));
    },
    async list(req, res) {
        res.json(await integration_service_1.integrationService.list(req.user.organisation_id));
    },
    async connect(req, res) {
        const body = integration_model_1.integrationConnectSchema.parse(req.body);
        console.log(`[integrationController] startConnect: orgId=${req.user.organisation_id}, provider=${body.provider}`);
        res.json(await integration_service_1.integrationService.startConnect(req.user.organisation_id, body.provider, body));
    },
    async callback(req, res) {
        const { provider } = providerParamSchema.parse(req.params);
        console.log(`[integrationController] callback: orgId=${req.user.organisation_id}, provider=${provider}`);
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
        let provider = PROVIDER_ALIAS[req.params.provider] || req.params.provider;
        // QuickBooks returns the company id as `realmId` on the callback query;
        // other OAuth providers only carry code + state. Forward it through.
        const { code, state, realmId, error: oauthError } = req.query;
        const dest = new URL(`${frontendUrl()}/integrations`);
        try {
            if (oauthError) throw new Error(String(oauthError));
            // The HMAC-signed state is the authority on which provider started
            // this flow — the URL path is only a hint. Providers can share one
            // registered redirect URI (google_sheets borrows the google_ads
            // callback when it borrows that OAuth client), so route on the
            // state's provider; a forged/mismatched state still fails the HMAC.
            const { orgId, provider: signedProvider } = verifyState(state);
            if (signedProvider !== provider) {
                console.log(`[integrationController] oauthCallback: path=${provider} routed to state provider=${signedProvider}`);
                provider = signedProvider;
            }
            console.log(`[integrationController] oauthCallback success: orgId=${orgId}, provider=${provider}`);
            await integration_service_1.integrationService.finishConnect(orgId, provider, { code, realmId });
            dest.searchParams.set('connected', provider);
        } catch (err) {
            console.error(`[integrationController] oauthCallback error: provider=${provider}, message=${err.message}`);
            dest.searchParams.set('error', err.message || 'oauth_failed');
            dest.searchParams.set('provider', provider);
        }
        res.redirect(dest.toString());
    },
    async revoke(req, res) {
        const { provider } = providerParamSchema.parse(req.params);
        console.log(`[integrationController] revoke: orgId=${req.user.organisation_id}, provider=${provider}`);
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
        // Gated inline (like syncProgress below) because the service call is
        // fire-and-forget — syncNow's own quiet skip would still answer 200
        // "started" here, and the caller deserves the honest 403.
        if (!(await featuresService.orgHasProviderFeature(organisation_id, provider))) {
            return res.status(403).json({ error: 'Feature not enabled', code: 'FEATURE_DISABLED' });
        }
        console.log(`[integrationController] sync started: orgId=${organisation_id}, provider=${provider}, full=${full}`);
        integration_service_1.integrationService.syncNow(organisation_id, provider, { full, resources: resources ?? null })
            .catch((err) => console.error(`[integrations] sync ${provider} failed:`, err?.message || err));
        res.json({ started: true, provider, full, resources: resources ?? null });
    },
    // Global "Refresh all" — fire an incremental pull for every connected
    // provider (Dentally, GHL, Google/Meta Ads, QuickBooks). Fire-and-forget:
    // returns the providers that started; the UI polls per-provider progress.
    async syncAll(req, res) {
        console.log(`[integrationController] syncAll started: orgId=${req.user.organisation_id}`);
        const { started } = await integration_service_1.integrationService.syncAll(req.user.organisation_id);
        res.json({ started });
    },
    // Live progress of the running/last sync (in-memory). Polled by the UI bar.
    // Gated inline (not via integration.service.js like the other generic
    // entry points) because integrationService.syncProgress is synchronous
    // and this controller doesn't await its result before res.json — an
    // async gate INSIDE that service method would silently ship a Promise.
    async syncProgress(req, res) {
        const { provider } = providerParamSchema.parse(req.params);
        if (!(await featuresService.orgHasProviderFeature(req.user.organisation_id, provider))) {
            return res.status(403).json({ error: 'Feature not enabled', code: 'FEATURE_DISABLED' });
        }
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
        // practice_id is the agency-controlled mapping field; the rest of the
        // PATCH (PIT rotation, config) stays a normal owner power.
        if (req.body?.practice_id !== undefined && !(await isAgencyActor(req))) {
            return res.status(403).json({ error: 'Agency access required', code: 'AGENCY_ONLY' });
        }
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
            .then(async () => {
                // Freshly-synced leads may complete a lead↔appointment match —
                // re-run the sheet conversion export immediately (no_match rows
                // included, backoff gates ignored). Best-effort, never blocks
                // or fails the sync response.
                try {
                    const { sheetExportService } = await import('../services/sheet-export.service.js');
                    await sheetExportService.drainOrg(orgId, { includeNoMatch: true, ignoreBackoff: true });
                } catch { /* export re-check is best-effort */ }
            })
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
    // --- QuickBooks companies ----------------------------------------------
    async qbAccountsList(req, res) {
        res.json(await quickbooksAccountService.listAccounts(req.user.organisation_id));
    },
    async qbAccountConnect(req, res) {
        res.json(await quickbooksAccountService.connect(req.user.organisation_id));
    },
    async qbAccountSync(req, res) {
        const { id } = idParamSchema.parse(req.params);
        const orgId = req.user.organisation_id;
        const full = req.query.full === 'true';
        quickbooksAccountService.syncAccount(orgId, id, { full })
            .catch((err) => console.error('[quickbooks-account] sync failed:', err?.message || err));
        res.json({ started: true, accountId: id, full });
    },
    async qbAccountRemove(req, res) {
        const { id } = idParamSchema.parse(req.params);
        res.json(await quickbooksAccountService.removeAccount(req.user.organisation_id, id));
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
