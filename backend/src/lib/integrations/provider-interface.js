// IntegrationProvider — single contract every connector implements.
// Concrete providers register themselves in providers.js below.
//
// Each provider implements ALL of these methods. Methods that don't apply
// throw NotImplementedError so callers can detect via try/catch.

export class NotImplementedError extends Error {
    constructor(method) {
        super(`Method ${method} not implemented`);
        this.code = 'NOT_IMPLEMENTED';
    }
}

/**
 * Shape of a provider implementation.
 *
 * authorize(orgId, params)
 *   → { redirectUrl: string }      // OAuth start
 *   → { dnsRecords: [...] }        // SES domain verification
 *   → { pasteHint: string }        // broker (key-paste) providers
 *
 * callback(orgId, payload)
 *   Exchanges OAuth code → tokens, or accepts the pasted key.
 *   Persists encrypted secrets via integrationsRepo.upsertSecrets.
 *
 * refresh(orgId)
 *   Refresh OAuth access token. No-op for non-OAuth providers.
 *
 * revoke(orgId)
 *   Server-side token revocation + integrations row status='revoked'.
 *
 * webhook(payload, signature, headers)
 *   Verify signature, parse event, write to provider_events table.
 *
 * sync(orgId)
 *   Optional periodic poll (workers/sync.js calls this). Used by providers
 *   without realtime webhooks (e.g. Dentally polling).
 *
 * meta
 *   Static metadata: { id, label, authStyle: 'oauth' | 'broker_key' | 'platform' }
 */
export const providers = new Map();

export function registerProvider(meta, impl) {
    providers.set(meta.id, { meta, impl });
}

export function getProvider(id) {
    const p = providers.get(id);
    if (!p) throw new Error(`Unknown provider: ${id}`);
    return p;
}

export function listProviders() {
    return Array.from(providers.values()).map(({ meta }) => meta);
}
