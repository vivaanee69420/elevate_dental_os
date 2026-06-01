// GoHighLevel (LeadConnector) provider — API-key (broker) connect.
//
// We connect via a long-lived API key / Private Integration Token rather than
// OAuth: the owner pastes their GHL API key + Location ID once, we encrypt the
// key at rest and call the V2 API with `Authorization: Bearer <key>` +
// `location_id`/`locationId` on each request. No token refresh, no callback
// redirect — same shape as the Dentally broker connect.
//
//   authorize → { requiresKeyPaste, requiresLocationId, pasteHint }
//   callback  → persist encrypted { access_token: apiKey } + config.locationId
//   refresh   → no-op (API keys are long-lived; only revoked, never rotated)

import { registerProvider } from './provider-interface.js';
import { integrationRepository as integrationsRepository } from '../../repositories/integration.repository.js';
import { encryptSecret } from '../crypto.js';

const PASTE_HINT =
    'Paste a GoHighLevel Private Integration Token (Settings → Private Integrations → create a token with View Contacts + View Opportunities) and your Location ID (Settings → Business Info). Note: the legacy JWT "API Key" targets the old v1 API and will not work here.';

export const GoHighLevelProvider = {
    async authorize(orgId) {
        await integrationsRepository.upsert(orgId, 'gohighlevel', { status: 'pending' });
        return { requiresKeyPaste: true, requiresLocationId: true, pasteHint: PASTE_HINT };
    },

    // apiKey + locationId pasted in the connect modal. Stored as
    // secrets.access_token (the sync reads access_token) + config.locationId.
    async callback(orgId, { apiKey, locationId }) {
        if (!apiKey) throw new Error('GoHighLevel API key is required');
        if (!locationId) throw new Error('GoHighLevel Location ID is required');
        await integrationsRepository.upsertSecrets(orgId, 'gohighlevel', {
            config: { locationId: String(locationId).trim() },
            secrets: encryptSecret(JSON.stringify({ access_token: String(apiKey).trim() })),
            status: 'active',
            verified_at: new Date().toISOString(),
            // Long-lived API key — never auto-expired/refreshed on our side.
            expires_at: null,
        });
        return { ok: true };
    },

    // API keys don't rotate; nothing to refresh. Kept so the sync's
    // ensureFreshToken and the generic provider interface have a callable hook.
    async refresh() {
        return { ok: true };
    },

    async revoke(orgId) {
        await integrationsRepository.markRevoked(orgId, 'gohighlevel');
        return { ok: true };
    },

    async webhook() {
        // Webhooks deferred; inbound is bootstrap-pull + hourly resync.
        return { received: true };
    },

    async sync(orgId) {
        const { syncOneOrg } = await import('./gohighlevel-sync.js');
        return syncOneOrg(orgId);
    },
};

registerProvider(
    { id: 'gohighlevel', label: 'GoHighLevel', authStyle: 'broker_key', category: 'marketing' },
    GoHighLevelProvider,
);
