// ============================================================================
// Emergent integration service — store-only connect for the Emergent ops app
// (Treatments Accepted source). See treatmentaccepted.md.
//
// SCOPE: this persists the owner's Emergent base URL + API key (encrypted) and
// exposes the per-org webhook URL to paste into Emergent. The actual INGEST
// (pull/webhook → treatment_accepted rows) is still blocked on Emergent's API
// contract (field names + webhook signing secret), so connecting does NOT yet
// validate the key or pull data — the Business Hub card stays a placeholder via
// the emergentConnected() gate until the contract lands and the connector is wired.
// ============================================================================
import { integrationRepository } from "../repositories/integration.repository.js";
import { encryptSecret } from "../lib/crypto.js";
import { signWebhookToken } from "../lib/webhook-token.js";
import { invalidate as invalidateGating } from "../lib/integration-gating.js";
import { AppError } from "../middleware/errors.js";

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
            keyHint: row?.config?.key_hint ?? null, // last 4 chars, set at connect
            webhookUrl: webhookUrl(orgId),
            lastSyncAt: row?.last_sync_at ?? null,
        };
    },
    async connect(orgId, { baseUrl, apiKey }) {
        if (!baseUrl || !/^https?:\/\//i.test(baseUrl)) throw new AppError('A valid base URL (https://…) is required', 400);
        if (!apiKey || apiKey.trim().length < 8) throw new AppError('A valid API key is required', 400);
        const trimmedKey = apiKey.trim();
        await integrationRepository.upsertSecrets(orgId, PROVIDER, {
            config: { base_url: baseUrl.replace(/\/+$/, ''), key_hint: trimmedKey.slice(-4) },
            secrets: encryptSecret(JSON.stringify({ apiKey: trimmedKey })),
            status: 'active',
            verified_at: null, // not validated against Emergent yet (contract pending)
        });
        invalidateGating(orgId);
        return this.get(orgId);
    },
    async disconnect(orgId) {
        await integrationRepository.markRevoked(orgId, PROVIDER);
        invalidateGating(orgId);
        return { ok: true };
    },
};
