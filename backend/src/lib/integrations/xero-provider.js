// Xero OAuth2 provider — full flow: authorize, token exchange, tenant capture,
// rotating-refresh-token handling, and a periodic P&L sync.
//
//   authorize → login.xero.com/identity/connect/authorize  (offline_access for refresh)
//   token     → identity.xero.com/connect/token            (HTTP Basic client auth)
//   tenants   → api.xero.com/connections                   (capture tenantId)
//   callback  → PUBLIC /oauth/xero/callback (orgId recovered from signed state)
//
// Access tokens live 30 min; refresh tokens ROTATE on every refresh (a new
// refresh_token comes back each time) and are single-use — same race as GHL, so
// we claim the integration row before refreshing (integrationRepository.claimRefresh).

import { registerProvider } from './provider-interface.js';
import { integrationRepository as integrationsRepository } from '../../repositories/integration.repository.js';
import { encryptSecret, decryptSecret } from '../crypto.js';

const AUTHORIZE_URL = 'https://login.xero.com/identity/connect/authorize';
const TOKEN_URL = 'https://identity.xero.com/connect/token';
const CONNECTIONS_URL = 'https://api.xero.com/connections';
const SCOPES = [
    'openid', 'profile', 'email', 'offline_access',
    'accounting.reports.read', 'accounting.settings.read', 'accounting.transactions.read',
];

function backendUrl() {
    return process.env.BACKEND_PUBLIC_URL || 'http://localhost:8080';
}
function redirectUri() {
    return `${backendUrl()}/oauth/xero/callback`;
}
function basicAuth() {
    const { XERO_CLIENT_ID, XERO_CLIENT_SECRET } = process.env;
    return 'Basic ' + Buffer.from(`${XERO_CLIENT_ID}:${XERO_CLIENT_SECRET}`).toString('base64');
}

// Capture the first connected tenant (most practices authorise a single org).
async function fetchTenantId(accessToken) {
    const res = await fetch(CONNECTIONS_URL, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const conns = await res.json();
    return Array.isArray(conns) && conns[0] ? conns[0].tenantId : null;
}

async function persistTokenResponse(orgId, body, tenantId) {
    return integrationsRepository.upsertSecrets(orgId, 'xero', {
        config: { tenant_id: tenantId ?? null, token_type: body.token_type, scope: body.scope },
        secrets: encryptSecret(JSON.stringify({
            access_token: body.access_token,
            refresh_token: body.refresh_token,
        })),
        status: 'active',
        verified_at: new Date().toISOString(),
        scopes: SCOPES,
        expires_at: body.expires_in ? new Date(Date.now() + body.expires_in * 1000).toISOString() : null,
    });
}

export const XeroProvider = {
    async authorize(orgId) {
        if (!process.env.XERO_CLIENT_ID) throw new Error('XERO_CLIENT_ID is not configured');
        const { signState } = await import('../oauth-state.js');
        const state = signState({ orgId, provider: 'xero' });
        const url = new URL(AUTHORIZE_URL);
        url.searchParams.set('response_type', 'code');
        url.searchParams.set('client_id', process.env.XERO_CLIENT_ID);
        url.searchParams.set('scope', SCOPES.join(' '));
        url.searchParams.set('redirect_uri', redirectUri());
        url.searchParams.set('state', state);
        await integrationsRepository.upsert(orgId, 'xero', { status: 'pending' });
        return { redirectUrl: url.toString() };
    },

    async callback(orgId, { code }) {
        const { XERO_CLIENT_ID, XERO_CLIENT_SECRET } = process.env;
        if (!XERO_CLIENT_ID || !XERO_CLIENT_SECRET) throw new Error('Xero OAuth env vars missing');
        if (!code) throw new Error('Missing authorization code');

        const res = await fetch(TOKEN_URL, {
            method: 'POST',
            headers: {
                Authorization: basicAuth(),
                'Content-Type': 'application/x-www-form-urlencoded',
                Accept: 'application/json',
            },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                code,
                redirect_uri: redirectUri(),
            }).toString(),
        });
        const body = await res.json();
        if (!res.ok) {
            await integrationsRepository.markFailed(orgId, 'xero', body.error_description ?? body.error ?? 'oauth_failed');
            throw new Error(body.error_description ?? 'Xero OAuth exchange failed');
        }
        const tenantId = await fetchTenantId(body.access_token);
        await persistTokenResponse(orgId, body, tenantId);
        return { ok: true };
    },

    async refresh(orgId) {
        const { XERO_CLIENT_ID, XERO_CLIENT_SECRET } = process.env;
        if (!XERO_CLIENT_ID || !XERO_CLIENT_SECRET) throw new Error('Xero OAuth env vars missing');

        // Rotating single-use refresh token: only the caller that claims refreshes.
        const claimed = await integrationsRepository.claimRefresh(orgId, 'xero');
        if (!claimed) return { skipped: 'refresh_in_progress' };
        try {
            const integration = await integrationsRepository.getByProvider(orgId, 'xero');
            if (!integration?.secrets) throw new Error('No stored credentials to refresh');
            const { refresh_token } = JSON.parse(decryptSecret(integration.secrets));
            if (!refresh_token) throw new Error('No refresh_token stored');

            const res = await fetch(TOKEN_URL, {
                method: 'POST',
                headers: {
                    Authorization: basicAuth(),
                    'Content-Type': 'application/x-www-form-urlencoded',
                    Accept: 'application/json',
                },
                body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token }).toString(),
            });
            const body = await res.json();
            if (!res.ok) {
                await integrationsRepository.markFailed(orgId, 'xero', body.error_description ?? body.error ?? 'refresh_failed');
                throw new Error(body.error_description ?? 'Xero token refresh failed');
            }
            await persistTokenResponse(orgId, body, integration.config?.tenant_id ?? null);
            return { ok: true };
        } finally {
            await integrationsRepository.clearRefresh(orgId, 'xero');
        }
    },

    async revoke(orgId) {
        await integrationsRepository.markRevoked(orgId, 'xero');
        return { ok: true };
    },

    async webhook() {
        // Xero uses webhooks for some events; deferred. Sync is the poll path.
        return { received: true };
    },

    async sync(orgId) {
        const { syncOneOrg } = await import('./xero-sync.js');
        return syncOneOrg(orgId);
    },
};

registerProvider(
    { id: 'xero', label: 'Xero', authStyle: 'oauth', category: 'accounting' },
    XeroProvider,
);
