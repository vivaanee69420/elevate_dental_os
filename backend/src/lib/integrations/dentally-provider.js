// Dentally provider — hybrid key-or-OAuth2.
//
//   authorize(method:'key')   -> { requiresKeyPaste } (paste an API token)
//   authorize(method:'oauth') -> { redirectUrl } to Dentally consent
//   callback({code})          -> exchange + persist {access_token, refresh_token}
//   callback({apiKey})        -> persist the long-lived API token (no refresh)
//   refresh()                 -> rotate the access token (single-use refresh token,
//                                claimRefresh race guard like Xero/GHL)
//
// Dentally runs a Doorkeeper OAuth2 server. Access tokens live ~2h; refresh
// tokens rotate (a new one each refresh), so we claim the row before refreshing.

import { registerProvider } from './provider-interface.js';
import { integrationRepository as integrationsRepository } from '../../repositories/integration.repository.js';
import { encryptSecret, decryptSecret } from '../crypto.js';

const PASTE_HINT = 'Paste your Dentally Bearer token from Dentally → Settings → API.';

// Dentally (Doorkeeper) REQUIRES the `scope` param on authorize — omitting it
// returns invalid_request/missing_param, and an UNREGISTERED scope value makes
// it 500 (server_error) instead of a clean invalid_scope. Default to the three
// documented-valid read scopes so authorize always succeeds; widen via
// DENTALLY_SCOPES to whatever the registered Dentally app actually exposes
// (e.g. add payment:read invoice:read treatment:read once confirmed).
const DEFAULT_SCOPES = 'patient:read appointment:read user:read';
function dentallyScopes() { return process.env.DENTALLY_SCOPES || DEFAULT_SCOPES; }

function authBase() { return process.env.DENTALLY_AUTH_BASE || 'https://api.dentally.co'; }
function authorizeUrl() { return `${authBase()}/oauth/authorize`; }
function tokenUrl() { return `${authBase()}/oauth/token`; }
function backendUrl() { return process.env.BACKEND_PUBLIC_URL || 'http://localhost:8080'; }
function redirectUri() { return `${backendUrl()}/oauth/dentally/callback`; }

async function persistTokenResponse(orgId, body) {
    return integrationsRepository.upsertSecrets(orgId, 'dentally', {
        config: { token_type: body.token_type, scope: body.scope ?? null },
        secrets: encryptSecret(JSON.stringify({
            access_token: body.access_token,
            refresh_token: body.refresh_token,
        })),
        status: 'active',
        verified_at: new Date().toISOString(),
        scopes: body.scope ? body.scope.split(' ') : null,
        expires_at: body.expires_in ? new Date(Date.now() + body.expires_in * 1000).toISOString() : null,
    });
}

async function exchange(orgId, params) {
    const { DENTALLY_CLIENT_ID, DENTALLY_CLIENT_SECRET } = process.env;
    if (!DENTALLY_CLIENT_ID || !DENTALLY_CLIENT_SECRET) {
        throw new Error('DENTALLY_CLIENT_ID / DENTALLY_CLIENT_SECRET not configured');
    }
    const res = await fetch(tokenUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({
            client_id: DENTALLY_CLIENT_ID,
            client_secret: DENTALLY_CLIENT_SECRET,
            ...params,
        }).toString(),
    });
    const body = await res.json();
    if (!res.ok) {
        await integrationsRepository.markFailed(orgId, 'dentally', body.error_description ?? body.error ?? 'oauth_failed');
        throw new Error(body.error_description ?? body.error ?? 'Dentally OAuth exchange failed');
    }
    return body;
}

export const DentallyProvider = {
    async authorize(orgId, extra = {}) {
        if (extra.method === 'key') {
            await integrationsRepository.upsert(orgId, 'dentally', { status: 'pending' });
            return { requiresKeyPaste: true, pasteHint: PASTE_HINT };
        }
        if (!process.env.DENTALLY_CLIENT_ID) throw new Error('DENTALLY_CLIENT_ID is not configured');
        const { signState } = await import('../oauth-state.js');
        const state = signState({ orgId, provider: 'dentally' });
        const url = new URL(authorizeUrl());
        url.searchParams.set('response_type', 'code');
        url.searchParams.set('client_id', process.env.DENTALLY_CLIENT_ID);
        url.searchParams.set('redirect_uri', redirectUri());
        url.searchParams.set('state', state);
        url.searchParams.set('scope', dentallyScopes());
        await integrationsRepository.upsert(orgId, 'dentally', { status: 'pending' });
        return { redirectUrl: url.toString() };
    },

    async callback(orgId, payload = {}) {
        if (payload.code) {
            const body = await exchange(orgId, {
                grant_type: 'authorization_code',
                code: payload.code,
                redirect_uri: redirectUri(),
            });
            await persistTokenResponse(orgId, body);
            return { ok: true };
        }
        if (payload.apiKey) {
            await integrationsRepository.upsertSecrets(orgId, 'dentally', {
                config: payload.baseUrl ? { base_url: payload.baseUrl } : {},
                secrets: encryptSecret(JSON.stringify({ apiKey: payload.apiKey })),
                status: 'active',
                verified_at: new Date().toISOString(),
                expires_at: null,
            });
            return { ok: true };
        }
        throw new Error('authorization code or apiKey required');
    },

    async refresh(orgId) {
        const claimed = await integrationsRepository.claimRefresh(orgId, 'dentally');
        if (!claimed) return { skipped: 'refresh_in_progress' };
        try {
            const integration = await integrationsRepository.getByProvider(orgId, 'dentally');
            if (!integration?.secrets) throw new Error('No stored credentials to refresh');
            const parsed = JSON.parse(decryptSecret(integration.secrets));
            if (parsed.apiKey) return { ok: true };
            if (!parsed.refresh_token) throw new Error('No refresh_token stored');
            const body = await exchange(orgId, { grant_type: 'refresh_token', refresh_token: parsed.refresh_token });
            await persistTokenResponse(orgId, body);
            return { ok: true };
        } finally {
            await integrationsRepository.clearRefresh(orgId, 'dentally');
        }
    },

    async revoke(orgId) {
        await integrationsRepository.markRevoked(orgId, 'dentally');
        return { ok: true };
    },

    async webhook() { return { received: true }; },

    async sync(orgId) {
        const { syncOneOrg } = await import('./dentally-sync.js');
        return syncOneOrg(orgId);
    },
};

registerProvider(
    { id: 'dentally', label: 'Dentally', authStyle: 'oauth_or_key', category: 'pms' },
    DentallyProvider,
);
