// ============================================================================
// GoHighLevel subaccount service — owner-only management of N GHL Locations per
// org. Each account carries its own Private Integration Token (encrypted) and a
// random webhook token. Sync + webhooks pull contacts/leads for the account.
// ============================================================================
import crypto from "node:crypto";
import { integrationAccountRepository } from "../repositories/integration-account.repository.js";
import { encryptSecret } from "../lib/crypto.js";
import * as gohighlevel_sync_1 from "../lib/integrations/gohighlevel-sync.js";
import { integrationRepository } from "../repositories/integration.repository.js";
import { invalidate as invalidateGating } from "../lib/integration-gating.js";
import * as errors_1 from "../middleware/errors.js";

const PROVIDER = 'gohighlevel';

export const ghlAccountService = {
    async listAccounts(orgId) {
        const accounts = await integrationAccountRepository.list(orgId, PROVIDER);
        // Decorate each account with the webhook URL the owner pastes into that GHL
        // location's settings (the random webhook_token IS the per-account webhook
        // credential — owner-facing, like the Dentally webhook-info URL).
        const base = process.env.BACKEND_PUBLIC_URL || process.env.APP_URL || 'http://localhost:8080';
        return {
            accounts: accounts.map((a) => ({
                ...a,
                webhook_url: a.webhook_token ? `${base}/webhooks/gohighlevel/${a.webhook_token}` : null,
            })),
        };
    },

    async addAccount(orgId, { token, locationId, label = null }) {
        if (!token || !String(token).trim()) throw new errors_1.AppError('token is required', 400);
        if (!locationId || !String(locationId).trim()) throw new errors_1.AppError('locationId is required', 400);
        const loc = String(locationId).trim();

        const dup = await integrationAccountRepository.getByLocation(orgId, PROVIDER, loc);
        if (dup && dup.status !== 'revoked') {
            throw new errors_1.AppError('That GoHighLevel location is already connected', 409);
        }

        // Validate the PIT against the Location before persisting anything.
        let name = label;
        try {
            const info = await gohighlevel_sync_1.fetchLocation(String(token).trim(), loc);
            name = label || info.name || 'GoHighLevel';
        } catch (err) {
            throw new errors_1.AppError(`Could not validate that token/location with GoHighLevel: ${err.message}`, 400);
        }

        const secrets = encryptSecret(JSON.stringify({ access_token: String(token).trim() }));
        const webhook_token = crypto.randomBytes(24).toString('hex');

        let account;
        if (dup) {
            account = await integrationAccountRepository.update(orgId, dup.id, {
                label: name, secrets, status: 'active',
                webhook_token, last_error: null,
            });
        } else {
            account = await integrationAccountRepository.insert(orgId, {
                provider: PROVIDER, external_account_id: loc,
                label: name, secrets, config: {}, status: 'active', webhook_token,
            });
        }

        await integrationRepository.upsert(orgId, PROVIDER, { status: 'active', last_error: null });
        invalidateGating(orgId);

        gohighlevel_sync_1.bootstrapAccount(orgId, account.id)
            .catch((err) => console.error('[ghl-account] bootstrap failed:', err?.message || err));

        return account;
    },

    async updateAccount(orgId, id, { label }) {
        const existing = await integrationAccountRepository.getById(orgId, id);
        if (!existing) throw new errors_1.AppError('account not found', 404);
        const patch = {};
        if (label !== undefined) patch.label = label;
        if (Object.keys(patch).length === 0) return existing;
        return await integrationAccountRepository.update(orgId, id, patch);
    },

    async removeAccount(orgId, id) {
        const existing = await integrationAccountRepository.getById(orgId, id);
        if (!existing) throw new errors_1.AppError('account not found', 404);
        await integrationAccountRepository.markRevoked(orgId, id);
        const remaining = await integrationAccountRepository.list(orgId, PROVIDER);
        if (!remaining.some((a) => a.status === 'active')) {
            await integrationRepository.markRevoked(orgId, PROVIDER);
        }
        invalidateGating(orgId);
        return { ok: true };
    },
};
