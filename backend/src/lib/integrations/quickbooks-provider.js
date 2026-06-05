// QuickBooks Online OAuth2 provider — full flow: authorize, token exchange,
// realmId (company id) capture, rotating-refresh-token handling, and a periodic
// P&L sync. Mirrors xero-provider.js; Xero stays available as a backup
// accounting source (both write monthly_financials, keyed by `source`).
//
//   authorize → appcenter.intuit.com/connect/oauth2     (scope com.intuit.quickbooks.accounting)
//   token     → oauth.platform.intuit.com/.../bearer    (HTTP Basic client auth)
//   company   → realmId arrives on the CALLBACK query (no connections call)
//   callback  → PUBLIC /oauth/quickbooks/callback (orgId from signed state)
//
// Access tokens live 1 hour; refresh tokens live ~100 days and ROTATE (a new
// refresh_token may come back on refresh) — same single-use race as Xero/GHL,
// so we claim the integration row before refreshing (claimRefresh).

import { registerProvider } from './provider-interface.js';
import { integrationRepository as integrationsRepository } from '../../repositories/integration.repository.js';
import { encryptSecret, decryptSecret } from '../crypto.js';

const AUTHORIZE_URL = 'https://appcenter.intuit.com/connect/oauth2';
const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const SCOPES = ['com.intuit.quickbooks.accounting'];

function backendUrl() {
    return process.env.BACKEND_PUBLIC_URL || 'http://localhost:8080';
}
function redirectUri() {
    return `${backendUrl()}/oauth/quickbooks/callback`;
}
function basicAuth() {
    const { QUICKBOOKS_CLIENT_ID, QUICKBOOKS_CLIENT_SECRET } = process.env;
    return 'Basic ' + Buffer.from(`${QUICKBOOKS_CLIENT_ID}:${QUICKBOOKS_CLIENT_SECRET}`).toString('base64');
}

async function persistTokenResponse(orgId, body, realmId) {
    return integrationsRepository.upsertSecrets(orgId, 'quickbooks', {
        config: { realm_id: realmId ?? null, token_type: body.token_type, scope: body.scope },
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

export const QuickBooksProvider = {
    async authorize(orgId) {
        if (!process.env.QUICKBOOKS_CLIENT_ID) throw new Error('QUICKBOOKS_CLIENT_ID is not configured');
        const { signState } = await import('../oauth-state.js');
        const state = signState({ orgId, provider: 'quickbooks' });
        const url = new URL(AUTHORIZE_URL);
        url.searchParams.set('response_type', 'code');
        url.searchParams.set('client_id', process.env.QUICKBOOKS_CLIENT_ID);
        url.searchParams.set('scope', SCOPES.join(' '));
        url.searchParams.set('redirect_uri', redirectUri());
        url.searchParams.set('state', state);
        await integrationsRepository.upsert(orgId, 'quickbooks', { status: 'pending' });
        return { redirectUrl: url.toString() };
    },

    async callback(orgId, { code, realmId }) {
        const { QUICKBOOKS_CLIENT_ID, QUICKBOOKS_CLIENT_SECRET } = process.env;
        if (!QUICKBOOKS_CLIENT_ID || !QUICKBOOKS_CLIENT_SECRET) throw new Error('QuickBooks OAuth env vars missing');
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
            await integrationsRepository.markFailed(orgId, 'quickbooks', body.error_description ?? body.error ?? 'oauth_failed');
            throw new Error(body.error_description ?? 'QuickBooks OAuth exchange failed');
        }
        // realmId is the QuickBooks company id; Intuit returns it on the callback
        // query string, not from a token/connections endpoint. Without it the
        // sync cannot address /v3/company/{realmId}/...
        if (!realmId) throw new Error('QuickBooks callback missing realmId (company id)');
        await persistTokenResponse(orgId, body, realmId);
        return { ok: true };
    },

    async refresh(orgId) {
        const { QUICKBOOKS_CLIENT_ID, QUICKBOOKS_CLIENT_SECRET } = process.env;
        if (!QUICKBOOKS_CLIENT_ID || !QUICKBOOKS_CLIENT_SECRET) throw new Error('QuickBooks OAuth env vars missing');

        // Rotating single-use refresh token: only the caller that claims refreshes.
        const claimed = await integrationsRepository.claimRefresh(orgId, 'quickbooks');
        if (!claimed) return { skipped: 'refresh_in_progress' };
        try {
            const integration = await integrationsRepository.getByProvider(orgId, 'quickbooks');
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
                await integrationsRepository.markFailed(orgId, 'quickbooks', body.error_description ?? body.error ?? 'refresh_failed');
                throw new Error(body.error_description ?? 'QuickBooks token refresh failed');
            }
            await persistTokenResponse(orgId, body, integration.config?.realm_id ?? null);
            return { ok: true };
        } finally {
            await integrationsRepository.clearRefresh(orgId, 'quickbooks');
        }
    },

    async revoke(orgId) {
        await integrationsRepository.markRevoked(orgId, 'quickbooks');
        return { ok: true };
    },

    async webhook() {
        // QuickBooks supports webhooks for entity events; deferred. Sync is the poll path.
        return { received: true };
    },

    async sync(orgId) {
        const { syncOneOrg } = await import('./quickbooks-sync.js');
        return syncOneOrg(orgId);
    },
};

registerProvider(
    { id: 'quickbooks', label: 'QuickBooks', authStyle: 'oauth', category: 'accounting' },
    QuickBooksProvider,
);
