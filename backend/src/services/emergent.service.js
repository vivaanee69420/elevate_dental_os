// ============================================================================
// Emergent integration service — connect + pull for the Emergent ops app
// (Treatments Accepted source). See treatmentaccepted.md.
//
// SCOPE: persists the owner's Emergent base URL + API key (encrypted), validates
// the key against the live API on connect, runs an initial pull, and exposes a
// manual re-sync. Ingest pulls accepted treatments via emergent-sync.js into
// treatment_accepted; the Business Hub card reads them through the
// emergentConnected() gate. (The inbound webhook URL is still surfaced but
// remains pending Emergent's signing-secret contract — pull is the live path.)
// ============================================================================
import { integrationRepository } from "../repositories/integration.repository.js";
import { encryptSecret } from "../lib/crypto.js";
import { signWebhookToken } from "../lib/webhook-token.js";
import { invalidate as invalidateGating } from "../lib/integration-gating.js";
import { AppError } from "../middleware/errors.js";
import { verifyCredentials, syncOrg } from "../lib/integrations/emergent-sync.js";
import { emergentPracticeMapRepository } from "../repositories/emergent-practice-map.repository.js";
import { treatmentAcceptedRepository } from "../repositories/treatment-accepted.repository.js";

const PROVIDER = 'emergent';

function webhookUrl(orgId) {
    const base = process.env.BACKEND_PUBLIC_URL || process.env.APP_URL || 'http://localhost:8080';
    try {
        return `${base}/webhooks/${PROVIDER}/${signWebhookToken(orgId)}`;
    } catch {
        // OAUTH_STATE_SECRET unset on the server — surface null, the UI shows a hint.
        return null;
    }
}

function maskKey(secrets) {
    // secrets is encrypted; we never decrypt for display. Track a last-4 hint in
    // config instead (set at connect time). Returns null when not connected.
    return null;
}

export const emergentService = {
    async get(orgId) {
        const row = await integrationRepository.getByProvider(orgId, PROVIDER);
        const connected = row?.status === 'active';
        return {
            connected,
            status: row?.status ?? null,
            baseUrl: row?.config?.base_url ?? null,
            keyHint: row?.config?.key_hint ?? null,
            webhookUrl: webhookUrl(orgId),
            webhookSecretSet: !!row?.config?.webhook_secret,
            lastSyncAt: row?.last_sync_at ?? null,
        };
    },
    async connect(orgId, { baseUrl, apiKey }) {
        if (!baseUrl || !/^https?:\/\//i.test(baseUrl)) throw new AppError('A valid base URL (https://…) is required', 400);
        if (!apiKey || apiKey.trim().length < 8) throw new AppError('A valid API key is required', 400);
        const trimmedKey = apiKey.trim();
        const cleanBase = baseUrl.replace(/\/+$/, '');
        // Validate the key against the live Emergent API before persisting, so a
        // bad key fails the connect instead of silently storing dead credentials.
        try {
            await verifyCredentials(cleanBase, trimmedKey);
        } catch (err) {
            throw new AppError(`Could not reach Emergent with that key: ${err.message}`, 400);
        }
        await integrationRepository.upsertSecrets(orgId, PROVIDER, {
            config: { base_url: cleanBase, key_hint: trimmedKey.slice(-4) },
            secrets: encryptSecret(JSON.stringify({ apiKey: trimmedKey })),
            status: 'active',
            verified_at: new Date().toISOString(),
        });
        invalidateGating(orgId);
        // Initial pull (full history). Fire-and-forget — connect returns straight
        // away; the rows land in the background. Errors are logged, not fatal.
        syncOrg(orgId, { full: true }).catch((err) =>
            console.error(`[emergent] initial sync failed for org ${orgId}:`, err.message),
        );
        return this.get(orgId);
    },
    // Manual re-sync (Refresh button). `full` re-pulls all-time; otherwise the
    // incremental trailing window. Returns { synced } so the UI can confirm.
    async sync(orgId, { full = false } = {}) {
        const row = await integrationRepository.getByProvider(orgId, PROVIDER);
        if (row?.status !== 'active') throw new AppError('Emergent is not connected', 400);
        return syncOrg(orgId, { full });
    },
    async disconnect(orgId) {
        await integrationRepository.markRevoked(orgId, PROVIDER);
        invalidateGating(orgId);
        return { ok: true };
    },

    // Businesses Emergent has sent + their current practice mapping + the org's
    // practice options for the dropdown. Owner/practice_manager read.
    async listPractices(orgId) {
        const row = await integrationRepository.getByProvider(orgId, PROVIDER);
        const [businesses, practices] = await Promise.all([
            emergentPracticeMapRepository.list(orgId),
            emergentPracticeMapRepository.practiceOptions(orgId),
        ]);
        return { connected: row?.status === 'active', businesses, practices };
    },

    // Set (or clear) one business -> practice mapping, then re-stamp existing
    // treatment_accepted rows so the change is reflected instantly (no re-sync).
    // practiceId null = intentionally unmapped. Owner-only.
    async setPracticeMapping(orgId, { businessId, practiceId }) {
        if (!businessId || String(businessId).trim() === '') {
            throw new AppError('business_id is required', 400);
        }
        // Look up the cached name so the map row keeps a label even if discovery
        // has not stamped it yet (best-effort; null is fine).
        const existing = (await emergentPracticeMapRepository.list(orgId))
            .find((b) => b.business_id === String(businessId));
        await emergentPracticeMapRepository.setMapping(
            orgId, businessId, existing?.business_name ?? null, practiceId ?? null,
        );
        const updated = await treatmentAcceptedRepository.restampPractice(orgId, businessId, practiceId ?? null);
        const result = await this.listPractices(orgId);
        return { ...result, restamped: updated };
    },
};
