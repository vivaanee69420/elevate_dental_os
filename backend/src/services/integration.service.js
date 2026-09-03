// ============================================================================
// Integration service — wires per-provider IntegrationProvider impls into
// the 5-layer architecture. Owner-only RBAC checked at route level.
// ============================================================================
import * as integration_repository_1 from "../repositories/integration.repository.js";
import { integrationAccountRepository } from "../repositories/integration-account.repository.js";
import "../lib/integrations/index.js";
import { getProvider, listProviders } from "../lib/integrations/provider-interface.js";
import * as errors_1 from "../middleware/errors.js";
import * as dentally_sync_1 from "../lib/integrations/dentally-sync.js";
import * as xero_sync_1 from "../lib/integrations/xero-sync.js";
import * as quickbooks_sync_1 from "../lib/integrations/quickbooks-sync.js";
import * as google_ads_sync_1 from "../lib/integrations/google-ads-sync.js";
import * as meta_ads_sync_1 from "../lib/integrations/meta-ads-sync.js";
import * as gohighlevel_sync_1 from "../lib/integrations/gohighlevel-sync.js";
import { signWebhookToken } from "../lib/webhook-token.js";
import { setProgress, getProgress } from "../lib/integrations/sync-progress.js";
import { invalidate as invalidateGating } from "../lib/integration-gating.js";
import { featuresService } from "./features.service.js";

// Guard for the generic multi-provider entry points (connect/callback/
// refresh/webhook-info/webhook-secret) — the ONLY routes for the three
// feature-bound providers (emergent, google_sheets, google_sheets_writer)
// that aren't already behind a static requireFeature(key) route gate (their
// own literal-path routes, e.g. `/emergent`, `/google-sheets/status`, are).
// A provider absent from PROVIDER_FEATURE is unaffected (returns silently).
// `revoke` is deliberately NOT guarded — an org whose flag is flipped off
// must still be able to disconnect. See docs/API.md.
async function assertProviderFeature(orgId, provider) {
    if (!(await featuresService.orgHasProviderFeature(orgId, provider))) {
        throw new errors_1.AppError('Feature not enabled', 403, 'FEATURE_DISABLED');
    }
}

// Providers that receive real-time webhooks (vs poll-only).
const WEBHOOK_PROVIDERS = new Set(['dentally', 'emergent', 'callrail']);

// A long pull has legitimately-silent stretches (bulk upserts, the per-record
// link loop, conversations) where the syncer emits NO progress for minutes. The
// UI treats a frozen progress `at` as "the import stopped" after ~75s, so a
// healthy long pull falsely reads as stalled at its last percentage (the classic
// "stuck at 99%"). Re-stamp the in-memory progress every HEARTBEAT_MS while the
// awaited syncer runs to keep `at` fresh. When the process genuinely dies the
// interval dies with it, so a real stall still freezes `at` and trips the UI
// guard as intended. The empty patch only refreshes `at` (setProgress always
// stamps it) — phase/pct/count are preserved.
const HEARTBEAT_MS = 20_000;
export async function runWithHeartbeat(orgId, provider, run) {
    const beat = setInterval(() => {
        const cur = getProgress(orgId, provider);
        if (cur?.running && !cur.done) setProgress(orgId, provider, {});
    }, HEARTBEAT_MS);
    if (typeof beat.unref === 'function') beat.unref(); // never hold the event loop open
    try {
        return await run();
    } finally {
        clearInterval(beat);
    }
}

// Providers that expose a real on-demand pull (button + first-connect sync).
// The broker provider's own .sync() is a stub; the real pull is the standalone
// per-provider syncOneOrg, dispatched here.
const ON_DEMAND_SYNCERS = {
    dentally: dentally_sync_1.syncOneOrg,
    xero: xero_sync_1.syncOneOrg,
    quickbooks: quickbooks_sync_1.syncOneOrg,
    google_ads: google_ads_sync_1.syncOneOrg,
    meta_ads: meta_ads_sync_1.syncOneOrg,
    gohighlevel: gohighlevel_sync_1.syncOneOrg,
};

// Providers the global "Refresh all" button pulls — Dentally, GoHighLevel,
// Google Ads, Meta Ads, QuickBooks. Always INCREMENTAL (latest data only, never
// a full/historical backfill).
const REFRESH_ALL_PROVIDERS = ['dentally', 'gohighlevel', 'google_ads', 'meta_ads', 'quickbooks'];

export const integrationService = {
    async list(orgId) {
        const connected = await integration_repository_1.integrationRepository.list(orgId);
        // A feature-bound provider (emergent, google_sheets, google_sheets_writer)
        // the org lacks must not appear as a connectable card — already-connected
        // rows stay visible in `integrations` (disconnect must still work), only
        // the "start a new connection" list is filtered.
        const available = [];
        for (const meta of listProviders()) {
            if (await featuresService.orgHasProviderFeature(orgId, meta.id)) available.push(meta);
        }
        return { integrations: connected, available };
    },
    async startConnect(orgId, provider, extra = {}) {
        await assertProviderFeature(orgId, provider);
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
        await assertProviderFeature(orgId, provider);
        const { impl } = getProvider(provider);
        let result;
        try {
            result = await impl.callback(orgId, payload);
        } catch (err) {
            throw new errors_1.AppError(err.message || 'Connect failed', 400);
        }
        // Reconnect flips status back to active → un-hide this provider's data now.
        invalidateGating(orgId);
        // First-connect pull: kick off immediately, but DO NOT await it — the
        // pull can be slow or hang, and blocking the connect response leaves the
        // UI stuck on "Saving…". Fire-and-forget; progress is polled by the UI
        // overlay and last_sync_at/last_error land on the row.
        //
        // Dentally needs the full bootstrap (detect sites -> auto-create+map
        // practices -> pull) so appointments/payments resolve a practice instead
        // of being skipped. A plain syncNow here would run with an empty siteMap
        // and store zero appointments/payments (the all-zeros bug).
        if (provider === 'dentally') {
            this.bootstrapDentally(orgId).catch((err) => {
                console.error('[integrations] dentally bootstrap failed:', err?.message || err);
            });
        } else if (provider === 'gohighlevel') {
            // GHL bootstrap = full-history pull of contacts + opportunities with
            // progress (no sites to detect). Same fire-and-forget + overlay path.
            this.bootstrapGohighlevel(orgId).catch((err) => {
                console.error('[integrations] gohighlevel bootstrap failed:', err?.message || err);
            });
        } else if (ON_DEMAND_SYNCERS[provider]) {
            // Ad providers backfill the FULL window (6mo) on (re)connect, like
            // the Dentally/GHL bootstraps above; the nightly cron then maintains
            // the trailing 3mo. An incremental first pull would leave older
            // months short: spend/impressions/clicks are summed from daily
            // ad_metrics rows, so any month with un-synced early days undercounts.
            // (Reach is immune — it comes from the live account-level query, not
            // the daily sum.)
            const full = provider === 'meta_ads' || provider === 'google_ads';
            this.syncNow(orgId, provider, { full }).catch((err) => {
                console.error(`[integrations] first-sync ${provider} failed:`, err?.message || err);
            });
        }
        const firstSyncStarted = provider === 'dentally' || provider === 'gohighlevel' || !!ON_DEMAND_SYNCERS[provider];
        return { ok: true, ...result, firstSyncStarted };
    },
    // On-demand pull for a connected provider (Refresh button + first-connect).
    // full=true ignores the incremental cursor (re-pulls the default window) so a
    // backfill after mapping practices re-pulls previously-skipped rows.
    async syncNow(orgId, provider, { full = false, resources = null } = {}) {
        // Feature-bound providers skip QUIETLY (marker, not throw) when the
        // org's flag is off: syncAll's fire-and-forget loop and the generic
        // POST /:provider/sync both funnel here, and a throw would log noise /
        // stamp failure state for what is simply "not entitled". The
        // controller additionally 403s the direct route before firing.
        if (!(await featuresService.orgHasProviderFeature(orgId, provider))) {
            return { skipped: 'feature_disabled', provider };
        }
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
        // Concurrency guard: only ONE sync per org+provider may run at a time.
        // A second trigger (Refresh during the first-connect pull, a backfill
        // after practice-mapping, or a double click) must NOT start a parallel
        // run — both runs write the same in-memory progress key with their own
        // independent page counters, so the polled UI bar jumps backwards
        // (e.g. page 300 -> 120 -> 302). Skip when a run is active and fresh.
        // A stale flag (process died mid-run, but the Map survived) is ignored
        // so a crashed sync never wedges future syncs.
        const active = getProgress(orgId, provider);
        const SYNC_STALE_MS = 10 * 60 * 1000; // a live sync stamps progress far more often than this
        if (active?.running && active.at && Date.now() - active.at < SYNC_STALE_MS) {
            return { ok: true, provider, full, alreadyRunning: true };
        }
        // Reset page/totalPages too so a new run never briefly shows the prior run's page number.
        setProgress(orgId, provider, { running: true, pct: 0, phase: 'starting', done: false, error: null, page: 0, totalPages: null });
        try {
            const result = await runWithHeartbeat(orgId, provider, () =>
                syncer(orgId, arg, (p) => setProgress(orgId, provider, { running: true, ...p }), { full, resources }));
            setProgress(orgId, provider, { running: false, pct: 100, done: true });
            return { ok: true, provider, full, ...result };
        } catch (err) {
            setProgress(orgId, provider, { running: false, done: true, error: err.message });
            throw err;
        }
    },
    // Global "Refresh all": fire an INCREMENTAL pull (full=false) for every
    // connected provider in REFRESH_ALL_PROVIDERS. Fire-and-forget per provider —
    // each streams its own progress + stamps last_sync_at; syncNow's concurrency
    // guard skips any provider already mid-sync. Never backfills.
    async syncAll(orgId) {
        const connected = await integration_repository_1.integrationRepository.list(orgId);
        const targets = connected.filter(
            (i) => i.status === 'active'
                && REFRESH_ALL_PROVIDERS.includes(i.provider)
                && ON_DEMAND_SYNCERS[i.provider],
        );
        const started = [];
        for (const row of targets) {
            this.syncNow(orgId, row.provider, { full: false })
                .catch((err) => console.error(`[integrations] refresh-all ${row.provider} failed:`, err?.message || err));
            started.push(row.provider);
        }
        return { started };
    },
    // Dentally first-connect automation: detect sites -> auto-create+map
    // practices -> pull the recent window, as ONE sequential run sharing the
    // same progress key + concurrency guard as syncNow. This is what makes
    // "connect + paste key" the only manual step.
    async bootstrapDentally(orgId) {
        const provider = 'dentally';
        const integration = await integration_repository_1.integrationRepository.getByProvider(orgId, provider);
        if (!integration || integration.status === 'revoked' || !integration.secrets)
            throw new errors_1.AppError('dentally is not connected', 409);
        // Same guard as syncNow: never run two pulls for one org in parallel
        // (their progress counters would fight). A stale flag is ignored.
        const active = getProgress(orgId, provider);
        const SYNC_STALE_MS = 10 * 60 * 1000;
        if (active?.running && active.at && Date.now() - active.at < SYNC_STALE_MS) {
            return { ok: true, provider, alreadyRunning: true };
        }
        setProgress(orgId, provider, { running: true, pct: 0, phase: 'starting', done: false, error: null, page: 0, totalPages: null });
        try {
            const result = await runWithHeartbeat(orgId, provider, () =>
                dentally_sync_1.bootstrapOnConnect(
                    orgId,
                    integration,
                    (p) => setProgress(orgId, provider, { running: true, ...p }),
                ));
            setProgress(orgId, provider, { running: false, pct: 100, done: true });
            return { ok: true, provider, ...result };
        } catch (err) {
            setProgress(orgId, provider, { running: false, done: true, error: err.message });
            throw err;
        }
    },
    // GoHighLevel first-connect automation: full-history pull of contacts +
    // opportunities as ONE run sharing the same progress key + concurrency guard
    // as syncNow (so the connect overlay shows it land). GHL has no sites to map.
    async bootstrapGohighlevel(orgId) {
        const provider = 'gohighlevel';
        const integration = await integration_repository_1.integrationRepository.getByProvider(orgId, provider);
        if (!integration || integration.status === 'revoked' || !integration.secrets)
            throw new errors_1.AppError('gohighlevel is not connected', 409);
        const active = getProgress(orgId, provider);
        const SYNC_STALE_MS = 10 * 60 * 1000;
        if (active?.running && active.at && Date.now() - active.at < SYNC_STALE_MS) {
            return { ok: true, provider, alreadyRunning: true };
        }
        setProgress(orgId, provider, { running: true, pct: 0, phase: 'starting', done: false, error: null, page: 0, totalPages: null });
        try {
            const result = await runWithHeartbeat(orgId, provider, () =>
                gohighlevel_sync_1.bootstrapOnConnect(
                    orgId,
                    integration,
                    (p) => setProgress(orgId, provider, { running: true, ...p }),
                ));
            setProgress(orgId, provider, { running: false, pct: 100, done: true });
            return { ok: true, provider, ...result };
        } catch (err) {
            setProgress(orgId, provider, { running: false, done: true, error: err.message });
            throw err;
        }
    },
    syncProgress(orgId, provider) {
        return getProgress(orgId, provider) ?? { running: false, pct: 0, phase: 'idle' };
    },
    // List GoHighLevel pipelines + stages, to drive the stage-mapping UI.
    async detectPipelines(orgId, provider) {
        if (provider !== 'gohighlevel')
            throw new errors_1.AppError(`${provider} does not support pipeline detection`, 400);
        const integration = await integration_repository_1.integrationRepository.getByProvider(orgId, provider);
        if (!integration || integration.status === 'revoked' || !integration.secrets)
            throw new errors_1.AppError('gohighlevel is not connected', 409);
        return gohighlevel_sync_1.detectPipelines(orgId, integration);
    },
    // Persist the owner's GHL stage -> Elevate status mapping (config.stage_mappings).
    // Validated against ELEVATE_STATUSES so a bad value can't poison mapStage.
    async setStageMappings(orgId, provider, mappings) {
        if (provider !== 'gohighlevel')
            throw new errors_1.AppError(`${provider} does not support stage mappings`, 400);
        if (!mappings || typeof mappings !== 'object' || Array.isArray(mappings))
            throw new errors_1.AppError('mappings must be an object of { stageId: status }', 400);
        const allowed = new Set(gohighlevel_sync_1.ELEVATE_STATUSES);
        const clean = {};
        for (const [stageId, status] of Object.entries(mappings)) {
            if (status && allowed.has(status)) clean[String(stageId)] = status;
        }
        await integration_repository_1.integrationRepository.mergeConfig(orgId, provider, { stage_mappings: clean });
        return { ok: true, stage_mappings: clean };
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
    // Ad-account dimension + selection for the marketing views (Google/Meta).
    // Only the two ad providers have ad accounts; reject anything else.
    async adAccounts(orgId, provider) {
        if (provider !== 'google_ads' && provider !== 'meta_ads')
            throw new errors_1.AppError(`${provider} has no ad accounts`, 400);
        return integration_repository_1.integrationRepository.listAdAccounts(orgId, provider);
    },
    async setAdAccountSelection(orgId, provider, selectedIds) {
        if (provider !== 'google_ads' && provider !== 'meta_ads')
            throw new errors_1.AppError(`${provider} has no ad accounts`, 400);
        const accounts = await integration_repository_1.integrationRepository.setAdAccountSelection(orgId, provider, selectedIds);
        return { ok: true, accounts };
    },
    async revoke(orgId, provider) {
        const { impl } = getProvider(provider);
        const result = await impl.revoke(orgId);
        // Data-hiding takes effect immediately (drop the cached status snapshot).
        invalidateGating(orgId);
        return result;
    },
    async refresh(orgId, provider) {
        await assertProviderFeature(orgId, provider);
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
        await assertProviderFeature(orgId, provider);
        if (!WEBHOOK_PROVIDERS.has(provider)) {
            throw new errors_1.AppError(`${provider} does not support webhooks`, 400);
        }
        const base = process.env.BACKEND_PUBLIC_URL || process.env.APP_URL || 'http://localhost:8080';
        let token;
        try {
            token = signWebhookToken(orgId);
        } catch (err) {
            // signWebhookToken throws when OAUTH_STATE_SECRET is unset on the
            // server. That's an operator/config problem, not a crash — surface a
            // clear 501 (matching startConnect) so the UI shows "not configured"
            // instead of an opaque 500.
            const msg = err.message || 'webhook signing failed';
            if (/OAUTH_STATE_SECRET/i.test(msg)) {
                throw new errors_1.AppError(`${provider} webhooks are not configured on this server. ${msg}`, 501);
            }
            throw err;
        }
        const integration = await integration_repository_1.integrationRepository.getByProvider(orgId, provider);
        // Live status of the webhook on the provider side — a stored secret alone
        // does NOT mean events are flowing (the hook may be disabled or every
        // delivery may be failing on a secret mismatch). Best-effort; degrades to
        // null when the API key can't read webhooks (e.g. read-restricted -> 403).
        let live = null;
        if (provider === 'dentally') {
            live = await dentally_sync_1.getWebhookHealth(orgId, integration);
        }
        return {
            provider,
            url: `${base}/webhooks/${provider}/${token}`,
            configured: !!integration?.config?.webhook_secret,
            live,
            // Outcome of the most recent inbound delivery (verified | bad_signature
            // | no_secret). The leading indicator: it updates on the very next
            // event, before Dentally's cumulative counters flip, so the UI can
            // show "verified 10s ago" the instant a corrected secret works.
            lastResult: integration?.webhook_last_result ?? null,
        };
    },
    // Store/replace the per-org webhook signing secret (the value the owner also
    // sets in Dentally). Used to verify the HMAC on every inbound event.
    async setWebhookSecret(orgId, provider, secret) {
        await assertProviderFeature(orgId, provider);
        if (!WEBHOOK_PROVIDERS.has(provider)) {
            throw new errors_1.AppError(`${provider} does not support webhooks`, 400);
        }
        if (!secret || String(secret).length < 8) {
            throw new errors_1.AppError('webhook secret must be at least 8 characters', 400);
        }
        await integration_repository_1.integrationRepository.mergeConfig(orgId, provider, { webhook_secret: String(secret) });
        return { ok: true, configured: true };
    },

    // ---- CallRail (multi-company call tracking) ----------------------------
    // Provider-level status/sync/disconnect only. There is no singleton
    // key-paste connect route: every credential lives on an
    // integration_accounts row, one per CallRail company (Task 4's
    // callrail.service.js), mirroring GoHighLevel multi-subaccount. The
    // `integrations` row for 'callrail' is only ever the lightweight
    // "connected" marker Task 4 flips on when the first company is added —
    // exactly like GHL's own marker row.
    //
    // An org that has never connected a company has no marker row and no
    // integration_accounts rows: this must read as connected:false with
    // empty arrays, never throw (the panel's default view before Task 4 ships
    // account creation, and every org's steady state until the owner adds a
    // company).
    async callrailStatus(orgId) {
        const row = await integration_repository_1.integrationRepository.getByProvider(orgId, 'callrail');
        return {
            connected: row?.status === 'active',
            // Task 4's callrail.service.js owns the real per-company rows
            // (call counts, practice mapping, webhook URL) and the source
            // breakdown aggregate — neither exists yet without an
            // integration_accounts row to read.
            accounts: [],
            sourceBreakdown: [],
        };
    },
    // "Sync every company, one call" (Task 2's contract). The pull itself is
    // Task 6's callrail-sync.js, landing on top of Task 4's account rows —
    // neither exists yet, so there is nothing to pull. Answering { ingested: 0 }
    // rather than throwing keeps the route honest and safe to call at any
    // point in the rollout, connected or not.
    async callrailSync(_orgId) {
        return { ingested: 0 };
    },
    // Disconnects the provider AND every company beneath it (api.ts's own
    // words) — the marker row this method owns, plus every integration_accounts
    // row of provider 'callrail' for this org, which is already available via
    // the generic, secrets-safe integrationAccountRepository (Task 4 does not
    // need to revisit this). markRevoked on a row that doesn't exist is a
    // no-op UPDATE, so this is safe to call whether or not anything was ever
    // connected.
    async callrailDisconnect(orgId) {
        const accounts = await integrationAccountRepository.list(orgId, 'callrail');
        for (const account of accounts) {
            await integrationAccountRepository.markRevoked(orgId, account.id);
        }
        await integration_repository_1.integrationRepository.markRevoked(orgId, 'callrail');
        invalidateGating(orgId);
        return { connected: false };
    },

    // Back-compat shim for the original connect() signature.
    connect(orgId, input) {
        return this.startConnect(orgId, input.provider);
    },
};
