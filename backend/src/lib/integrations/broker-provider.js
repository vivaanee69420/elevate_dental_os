// Broker providers — API-key-only services (Dentally, SOE). User pastes the
// key ONCE in a modal; it's encrypted at rest and never returned via the API.

import { registerProvider } from './provider-interface.js';
import { integrationRepository as integrationsRepository } from '../../repositories/integration.repository.js';
import { encryptSecret } from '../crypto.js';

function makeBroker(id, label, category, pasteHint) {
    const impl = {
        async authorize(orgId) {
            await integrationsRepository.upsert(orgId, id, { status: 'pending' });
            return { pasteHint, requiresKeyPaste: true };
        },
        async callback(orgId, { apiKey, baseUrl }) {
            if (!apiKey) throw new Error('apiKey required');
            await integrationsRepository.upsertSecrets(orgId, id, {
                config: baseUrl ? { base_url: baseUrl } : {},
                secrets: encryptSecret(JSON.stringify({ apiKey })),
                status: 'active',
                verified_at: new Date().toISOString(),
                // Broker keys are long-lived API tokens — never auto-expired or
                // refreshed on our side. expires_at=null = treat as permanent;
                // the token only stops working if revoked here or in Dentally.
                expires_at: null,
            });
            return { ok: true };
        },
        async refresh() { return { ok: true }; },
        async revoke(orgId) {
            await integrationsRepository.markRevoked(orgId, id);
            return { ok: true };
        },
        async webhook() { return { received: true }; },
        async sync(_orgId) {
            // Real impl: fetch latest data from provider API, upsert into our tables.
            return { synced: 0, note: 'sync not yet implemented' };
        },
    };
    registerProvider({ id, label, authStyle: 'broker_key', category }, impl);
}

makeBroker('dentally', 'Dentally', 'pms',
    'Paste your Dentally Bearer token from Dentally → Settings → API.');
makeBroker('soe', 'Software of Excellence (Exact)', 'pms',
    'Paste your SOE/Exact API key from your SOE practice settings.');
