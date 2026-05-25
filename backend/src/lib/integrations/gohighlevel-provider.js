// GoHighLevel (LeadConnector) OAuth provider.
//
// Standalone rather than makeOauthStub because GHL needs: the chooselocation
// authorize URL, user_type=Location in the token exchange, locationId/companyId
// capture, and a single-use refresh-token rotation guarded against concurrent
// refresh (see refresh()).
//
//   authorize → marketplace.leadconnectorhq.com/oauth/chooselocation
//   token     → services.leadconnectorhq.com/oauth/token
//   callback  → handled by the PUBLIC /oauth/:provider/callback route (no JWT;
//               orgId is recovered from the HMAC-signed `state`).
//
// Refresh-token race (Edge Case 1): GHL refresh tokens are single-use. Two
// concurrent refreshes (hourly cron + manual POST /refresh) would burn the
// token and lock the org out. We claim the integration row via
// integrationRepository.claimRefresh() before refreshing; a caller that fails
// to claim backs off. No SELECT FOR UPDATE (PostgREST can't lock rows).

import { registerProvider } from './provider-interface.js';
import { integrationRepository as integrationsRepository } from '../../repositories/integration.repository.js';
import { encryptSecret, decryptSecret } from '../crypto.js';

const CHOOSE_LOCATION_URL = 'https://marketplace.leadconnectorhq.com/oauth/chooselocation';
const TOKEN_URL = 'https://services.leadconnectorhq.com/oauth/token';
const SCOPES = ['contacts.readonly', 'contacts.write', 'opportunities.readonly', 'opportunities.write'];

function backendUrl() {
    return process.env.BACKEND_PUBLIC_URL || 'http://localhost:8080';
}
function redirectUri() {
    return `${backendUrl()}/oauth/gohighlevel/callback`;
}

function persistTokenResponse(orgId, body, status = 'active') {
    return integrationsRepository.upsertSecrets(orgId, 'gohighlevel', {
        config: {
            locationId: body.locationId ?? null,
            companyId: body.companyId ?? null,
            userType: body.userType ?? 'Location',
            scope: body.scope ?? SCOPES.join(' '),
        },
        secrets: encryptSecret(JSON.stringify({
            access_token: body.access_token,
            refresh_token: body.refresh_token,
        })),
        status,
        verified_at: new Date().toISOString(),
        scopes: SCOPES,
        expires_at: body.expires_in ? new Date(Date.now() + body.expires_in * 1000).toISOString() : null,
    });
}

export const GoHighLevelProvider = {
    async authorize(orgId) {
        if (!process.env.GHL_CLIENT_ID) throw new Error('GHL_CLIENT_ID is not configured');
        // Lazy import to avoid a static import cycle with the provider.
        const { signState } = await import('../oauth-state.js');
        const state = signState({ orgId, provider: 'gohighlevel' });

        const url = new URL(CHOOSE_LOCATION_URL);
        url.searchParams.set('response_type', 'code');
        url.searchParams.set('client_id', process.env.GHL_CLIENT_ID);
        url.searchParams.set('scope', SCOPES.join(' '));
        url.searchParams.set('redirect_uri', redirectUri());
        url.searchParams.set('state', state);

        await integrationsRepository.upsert(orgId, 'gohighlevel', { status: 'pending' });
        return { redirectUrl: url.toString() };
    },

    async callback(orgId, { code }) {
        const { GHL_CLIENT_ID, GHL_CLIENT_SECRET } = process.env;
        if (!GHL_CLIENT_ID || !GHL_CLIENT_SECRET) throw new Error('GoHighLevel OAuth env vars missing');
        if (!code) throw new Error('Missing authorization code');

        const res = await fetch(TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
            body: new URLSearchParams({
                client_id: GHL_CLIENT_ID,
                client_secret: GHL_CLIENT_SECRET,
                grant_type: 'authorization_code',
                code,
                redirect_uri: redirectUri(),
                user_type: 'Location',
            }).toString(),
        });
        const body = await res.json();
        if (!res.ok) {
            await integrationsRepository.markFailed(orgId, 'gohighlevel', body.error_description ?? body.error ?? 'oauth_failed');
            throw new Error(body.error_description ?? 'GoHighLevel OAuth exchange failed');
        }
        await persistTokenResponse(orgId, body);
        return { ok: true };
    },

    async refresh(orgId) {
        const { GHL_CLIENT_ID, GHL_CLIENT_SECRET } = process.env;
        if (!GHL_CLIENT_ID || !GHL_CLIENT_SECRET) throw new Error('GoHighLevel OAuth env vars missing');

        // Single-use token guard: only the caller that claims the row refreshes.
        const claimed = await integrationsRepository.claimRefresh(orgId, 'gohighlevel');
        if (!claimed) return { skipped: 'refresh_in_progress' };

        try {
            const integration = await integrationsRepository.getByProvider(orgId, 'gohighlevel');
            if (!integration?.secrets) throw new Error('No stored credentials to refresh');
            const { refresh_token } = JSON.parse(decryptSecret(integration.secrets));
            if (!refresh_token) throw new Error('No refresh_token stored');

            const res = await fetch(TOKEN_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
                body: new URLSearchParams({
                    client_id: GHL_CLIENT_ID,
                    client_secret: GHL_CLIENT_SECRET,
                    grant_type: 'refresh_token',
                    refresh_token,
                    user_type: 'Location',
                }).toString(),
            });
            const body = await res.json();
            if (!res.ok) {
                await integrationsRepository.markFailed(orgId, 'gohighlevel', body.error_description ?? body.error ?? 'refresh_failed');
                throw new Error(body.error_description ?? 'GoHighLevel token refresh failed');
            }
            await persistTokenResponse(orgId, body);
            return { ok: true };
        } finally {
            await integrationsRepository.clearRefresh(orgId, 'gohighlevel');
        }
    },

    async revoke(orgId) {
        await integrationsRepository.markRevoked(orgId, 'gohighlevel');
        return { ok: true };
    },

    async webhook() {
        // Deferred: real-time webhook lands in a follow-up (see highleveltodo.md).
        return { received: true };
    },

    async sync(orgId) {
        const { syncOneOrg } = await import('./gohighlevel-sync.js');
        return syncOneOrg(orgId);
    },
};

registerProvider(
    { id: 'gohighlevel', label: 'GoHighLevel', authStyle: 'oauth', category: 'marketing' },
    GoHighLevelProvider,
);
