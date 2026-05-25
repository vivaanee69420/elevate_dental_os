// ============================================================================
// Integration service — wires per-provider IntegrationProvider impls into
// the 5-layer architecture. Owner-only RBAC checked at route level.
// ============================================================================
import * as integration_repository_1 from "../repositories/integration.repository.js";
import "../lib/integrations/index.js";
import { getProvider, listProviders } from "../lib/integrations/provider-interface.js";
import * as errors_1 from "../middleware/errors.js";
import * as dentally_sync_1 from "../lib/integrations/dentally-sync.js";
import * as xero_sync_1 from "../lib/integrations/xero-sync.js";
import * as gohighlevel_sync_1 from "../lib/integrations/gohighlevel-sync.js";
import { signWebhookToken } from "../lib/webhook-token.js";
import { setProgress, getProgress } from "../lib/integrations/sync-progress.js";

// Providers that receive real-time webhooks (vs poll-only).
const WEBHOOK_PROVIDERS = new Set(['dentally']);

// Providers that expose a real on-demand pull (button + first-connect sync).
// The broker provider's own .sync() is a stub; the real pull is the standalone
// per-provider syncOneOrg, dispatched here.
const ON_DEMAND_SYNCERS = {
    dentally: dentally_sync_1.syncOneOrg,
    xero: xero_sync_1.syncOneOrg,
    gohighlevel: gohighlevel_sync_1.syncOneOrg,
};

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
        let result;
        try {
            result = await impl.callback(orgId, payload);
        } catch (err) {
            throw new errors_1.AppError(err.message || 'Connect failed', 400);
        }
        // First-connect pull: kick off an immediate sync, but DO NOT await it —
        // the pull can be slow (paginated 30-day window) or hang, and blocking
        // the connect response leaves the UI stuck on "Saving…". Fire-and-forget:
        // the syncer records last_sync_at/last_error on the row, which the UI
        // reflects on the next integrations refresh.
        if (ON_DEMAND_SYNCERS[provider]) {
            this.syncNow(orgId, provider).catch((err) => {
                console.error(`[integrations] first-sync ${provider} failed:`, err?.message || err);
            });
        }
        return { ok: true, ...result, firstSyncStarted: !!ON_DEMAND_SYNCERS[provider] };
    },
    // On-demand pull for a connected provider (Refresh button + first-connect).
    // full=true ignores the incremental cursor (re-pulls the default window) so a
    // backfill after mapping practices re-pulls previously-skipped rows.
    async syncNow(orgId, provider, { full = false } = {}) {
        const syncer = ON_DEMAND_SYNCERS[provider];
        if (!syncer)
            throw new errors_1.AppError(`Provider ${provider} does not support on-demand sync`, 400);
        const integration = await integration_repository_1.integrationRepository.getByProvider(orgId, provider);
        if (!integration || integration.status === 'revoked' || !integration.secrets)
            throw new errors_1.AppError(`${provider} is not connected`, 409);
        // full pull: shim the cursor (for providers that key off last_sync_at)
        // AND pass { full } so the syncer can widen its window + lift row caps
        // for a true historical backfill.
        const arg = full ? { ...integration, last_sync_at: null } : integration;
        setProgress(orgId, provider, { running: true, pct: 0, phase: 'starting', done: false, error: null });
        try {
            const result = await syncer(orgId, arg, (p) => setProgress(orgId, provider, { running: true, ...p }), { full });
            setProgress(orgId, provider, { running: false, pct: 100, done: true });
            return { ok: true, provider, full, ...result };
        } catch (err) {
            setProgress(orgId, provider, { running: false, done: true, error: err.message });
            throw err;
        }
    },
    syncProgress(orgId, provider) {
        return getProgress(orgId, provider) ?? { running: false, pct: 0, phase: 'idle' };
    },
    // Sample Dentally for the distinct site_ids it returns, to drive practice mapping.
    async detectSiteIds(orgId, provider) {
        if (provider !== 'dentally')
            throw new errors_1.AppError(`${provider} does not support site-id detection`, 400);
        const integration = await integration_repository_1.integrationRepository.getByProvider(orgId, provider);
        if (!integration || integration.status === 'revoked' || !integration.secrets)
            throw new errors_1.AppError('dentally is not connected', 409);
        return dentally_sync_1.detectSiteIds(orgId, integration);
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
    // The per-org webhook URL to paste into the provider's dashboard. The token
    // is a stable signed encoding of orgId (no auth on the public webhook route).
    // `configured` reflects whether a verifying secret is already set.
    async webhookInfo(orgId, provider) {
        if (!WEBHOOK_PROVIDERS.has(provider)) {
            throw new errors_1.AppError(`${provider} does not support webhooks`, 400);
        }
        const base = process.env.BACKEND_PUBLIC_URL || process.env.APP_URL || 'http://localhost:8080';
        const token = signWebhookToken(orgId);
        const integration = await integration_repository_1.integrationRepository.getByProvider(orgId, provider);
        return {
            provider,
            url: `${base}/webhooks/${provider}/${token}`,
            configured: !!integration?.config?.webhook_secret,
        };
    },
    // Store/replace the per-org webhook signing secret (the value the owner also
    // sets in Dentally). Used to verify the HMAC on every inbound event.
    async setWebhookSecret(orgId, provider, secret) {
        if (!WEBHOOK_PROVIDERS.has(provider)) {
            throw new errors_1.AppError(`${provider} does not support webhooks`, 400);
        }
        if (!secret || String(secret).length < 8) {
            throw new errors_1.AppError('webhook secret must be at least 8 characters', 400);
        }
        await integration_repository_1.integrationRepository.mergeConfig(orgId, provider, { webhook_secret: String(secret) });
        return { ok: true, configured: true };
    },
    // Back-compat shim for the original connect() signature.
    connect(orgId, input) {
        return this.startConnect(orgId, input.provider);
    },
};
