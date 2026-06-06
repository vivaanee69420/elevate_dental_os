// Skeleton OAuth providers — same shape as Stripe, just needing real
// client_id/secret + token URLs from each provider's docs. Each one stops
// short of the real network call so the surface is testable without secrets.

import { registerProvider, NotImplementedError } from './provider-interface.js';
import { integrationRepository as integrationsRepository } from '../../repositories/integration.repository.js';
import { encryptSecret } from '../crypto.js';

function makeOauthStub({ id, label, category, scopes, authUrl, tokenUrl, clientIdEnv, clientSecretEnv }) {
    const impl = {
        async authorize(orgId) {
            const clientId = process.env[clientIdEnv];
            if (!clientId) throw new Error(`${clientIdEnv} not configured`);
            const state = Buffer.from(JSON.stringify({ orgId, provider: id, ts: Date.now() })).toString('base64url');
            const APP_URL = process.env.APP_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
            const url = new URL(authUrl);
            url.searchParams.set('response_type', 'code');
            url.searchParams.set('client_id', clientId);
            url.searchParams.set('scope', scopes.join(' '));
            url.searchParams.set('state', state);
            url.searchParams.set('redirect_uri', `${APP_URL}/api/integrations/${id}/callback`);
            await integrationsRepository.upsert(orgId, id, { status: 'pending' });
            return { redirectUrl: url.toString() };
        },
        async callback(orgId, { code }) {
            const clientId = process.env[clientIdEnv];
            const clientSecret = process.env[clientSecretEnv];
            if (!clientId || !clientSecret) throw new Error(`${id} OAuth env vars missing`);
            const APP_URL = process.env.APP_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
            const res = await fetch(tokenUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    grant_type: 'authorization_code',
                    code,
                    client_id: clientId,
                    client_secret: clientSecret,
                    redirect_uri: `${APP_URL}/api/integrations/${id}/callback`,
                }).toString(),
            });
            const body = await res.json();
            if (!res.ok) {
                await integrationsRepository.markFailed(orgId, id, body.error_description ?? body.error ?? 'oauth_failed');
                throw new Error(body.error_description ?? 'OAuth failed');
            }
            await integrationsRepository.upsertSecrets(orgId, id, {
                config: { token_type: body.token_type, scope: body.scope },
                secrets: encryptSecret(JSON.stringify({
                    access_token: body.access_token,
                    refresh_token: body.refresh_token,
                })),
                status: 'active',
                verified_at: new Date().toISOString(),
                scopes: scopes,
                expires_at: body.expires_in ? new Date(Date.now() + body.expires_in * 1000).toISOString() : null,
            });
            return { ok: true };
        },
        async refresh(_orgId) { throw new NotImplementedError(`${id}.refresh`); },
        async revoke(orgId) {
            await integrationsRepository.markRevoked(orgId, id);
            return { ok: true };
        },
        async webhook() { return { received: true }; },
        async sync(_orgId) { return { synced: 0 }; },
    };
    registerProvider({ id, label, authStyle: 'oauth', category }, impl);
}

// Xero and QuickBooks now have real providers (xero-provider.js /
// quickbooks-provider.js) — full OAuth + company capture + token refresh + P&L
// sync. Registered separately, not stubs.

makeOauthStub({
    id: 'google_calendar', label: 'Google Calendar', category: 'calendar',
    scopes: ['https://www.googleapis.com/auth/calendar.events'],
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    clientIdEnv: 'GOOGLE_CLIENT_ID', clientSecretEnv: 'GOOGLE_CLIENT_SECRET',
});

// google_ads is now a REAL provider (google-ads-provider.js) — full OAuth +
// accessible-customer capture + token refresh + spend sync. Removed from stubs.

// meta_ads is now a REAL provider (meta-ads-provider.js) — full OAuth +
// long-lived token + ad-account capture + token refresh + spend sync. Removed
// from stubs.

makeOauthStub({
    id: 'mailchimp', label: 'Mailchimp', category: 'marketing',
    scopes: [],
    authUrl: 'https://login.mailchimp.com/oauth2/authorize',
    tokenUrl: 'https://login.mailchimp.com/oauth2/token',
    clientIdEnv: 'MAILCHIMP_CLIENT_ID', clientSecretEnv: 'MAILCHIMP_CLIENT_SECRET',
});

makeOauthStub({
    id: 'slack', label: 'Slack', category: 'notifications',
    scopes: ['chat:write', 'channels:read'],
    authUrl: 'https://slack.com/oauth/v2/authorize',
    tokenUrl: 'https://slack.com/api/oauth.v2.access',
    clientIdEnv: 'SLACK_CLIENT_ID', clientSecretEnv: 'SLACK_CLIENT_SECRET',
});

makeOauthStub({
    id: 'zoom', label: 'Zoom', category: 'meetings',
    scopes: ['meeting:write'],
    authUrl: 'https://zoom.us/oauth/authorize',
    tokenUrl: 'https://zoom.us/oauth/token',
    clientIdEnv: 'ZOOM_CLIENT_ID', clientSecretEnv: 'ZOOM_CLIENT_SECRET',
});

makeOauthStub({
    id: 'docusign', label: 'DocuSign', category: 'contracts',
    scopes: ['signature'],
    authUrl: 'https://account.docusign.com/oauth/auth',
    tokenUrl: 'https://account.docusign.com/oauth/token',
    clientIdEnv: 'DOCUSIGN_CLIENT_ID', clientSecretEnv: 'DOCUSIGN_CLIENT_SECRET',
});

makeOauthStub({
    id: 'dropbox', label: 'Dropbox', category: 'storage',
    scopes: ['files.content.write', 'files.content.read'],
    authUrl: 'https://www.dropbox.com/oauth2/authorize',
    tokenUrl: 'https://api.dropboxapi.com/oauth2/token',
    clientIdEnv: 'DROPBOX_CLIENT_ID', clientSecretEnv: 'DROPBOX_CLIENT_SECRET',
});
