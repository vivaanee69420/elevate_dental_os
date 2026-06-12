// ============================================================================
// GoHighLevel subaccount service — owner-only management of N GHL Locations per
// org, each mapped 1:1 to a practice. Each account carries its own Private
// Integration Token (encrypted) and a random webhook token. Sync + webhooks
// stamp the account's practice_id on every contact/lead.
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
        return { accounts };
    },

    async addAccount(orgId, { token, locationId, practiceId = null, label = null }) {
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
                practice_id: practiceId, label: name, secrets, status: 'active',
                webhook_token, last_error: null,
            });
        } else {
            account = await integrationAccountRepository.insert(orgId, {
                provider: PROVIDER, external_account_id: loc, practice_id: practiceId,
                label: name, secrets, config: {}, status: 'active', webhook_token,
            });
        }

        await integrationRepository.upsert(orgId, PROVIDER, { status: 'active', last_error: null });
        invalidateGating(orgId);

        gohighlevel_sync_1.bootstrapAccount(orgId, account.id)
            .catch((err) => console.error('[ghl-account] bootstrap failed:', err?.message || err));

        return account;
    },

    async updateAccount(orgId, id, { practiceId, label }) {
        const existing = await integrationAccountRepository.getById(orgId, id);
        if (!existing) throw new errors_1.AppError('account not found', 404);
        const patch = {};
        if (practiceId !== undefined) patch.practice_id = practiceId || null;
        if (label !== undefined) patch.label = label;
        if (Object.keys(patch).length === 0) return existing;
        try {
            return await integrationAccountRepository.update(orgId, id, patch);
        } catch (err) {
            if (/duplicate key|unique/i.test(err.message)) {
                throw new errors_1.AppError('That practice is already linked to another subaccount', 409);
            }
            throw err;
        }
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
