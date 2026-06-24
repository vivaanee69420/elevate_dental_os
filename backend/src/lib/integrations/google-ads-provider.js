// Google Ads OAuth2 provider — full flow: authorize, token exchange,
// accessible-customer capture, token refresh, and a periodic spend/performance
// sync. Mirrors quickbooks-provider.js. MULTI-TENANT: one Google Cloud app
// (your CLIENT_ID/SECRET/DEVELOPER_TOKEN) serves every org; each org connects
// its OWN Google Ads account and all rows are keyed by organisation_id.
//
//   authorize → accounts.google.com/o/oauth2/v2/auth   (scope .../auth/adwords)
//   token     → oauth2.googleapis.com/token            (client_id+secret in body)
//   customers → googleads.googleapis.com/.../customers:listAccessibleCustomers
//   callback  → PUBLIC /oauth/google_ads/callback (orgId from signed state)
//
// Access tokens live 1 hour; Google refresh tokens do NOT rotate (unlike
// QuickBooks/GHL) but only arrive when authorize sends access_type=offline +
// prompt=consent — both are set below, else refresh() has nothing to use.
//
// Google Ads needs MORE than OAuth: a developer-token header on every Ads API
// call (GOOGLE_ADS_DEVELOPER_TOKEN), and an optional login-customer-id
// (GOOGLE_ADS_LOGIN_CUSTOMER_ID) when connecting client accounts under a
// Manager (MCC). The dev token + MCC are operator-level, NOT per-org.

import { registerProvider } from './provider-interface.js';
import { integrationRepository as integrationsRepository } from '../../repositories/integration.repository.js';
import { encryptSecret, decryptSecret } from '../crypto.js';

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPES = ['https://www.googleapis.com/auth/adwords'];

function apiBase() {
    return process.env.GOOGLE_ADS_API_BASE || 'https://googleads.googleapis.com';
}
function apiVersion() {
    // Google sunsets Ads API versions ~yearly; a sunset version 404s every call.
    // Keep this on a currently-supported version (override via env when bumping).
    return process.env.GOOGLE_ADS_API_VERSION || 'v20';
}
function backendUrl() {
    return process.env.BACKEND_PUBLIC_URL || 'http://localhost:8080';
}
function redirectUri() {
    return `${backendUrl()}/oauth/google_ads/callback`;
}

// Headers every Google Ads (not OAuth) call needs: bearer + developer token +
// optional login-customer-id (the MCC the client account sits under).
// `withLogin:false` omits the MCC header — required for
// customers:listAccessibleCustomers, which lists accounts for the AUTHENTICATED
// credential and rejects a login-customer-id with INVALID_ARGUMENT.
export function adsHeaders(accessToken, { withLogin = true } = {}) {
    const h = {
        Authorization: `Bearer ${accessToken}`,
        'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '',
        'Content-Type': 'application/json',
    };
    const login = (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || '').replace(/-/g, '');
    if (withLogin && login) h['login-customer-id'] = login;
    return h;
}

async function persistTokenResponse(orgId, body, configPatch = {}) {
    return integrationsRepository.upsertSecrets(orgId, 'google_ads', {
        config: { token_type: body.token_type, scope: body.scope, ...configPatch },
        secrets: encryptSecret(JSON.stringify({
            access_token: body.access_token,
            // Google omits refresh_token on a token *refresh* — keep the old one.
            refresh_token: body.refresh_token ?? configPatch.__refresh_token,
        })),
        status: 'active',
        verified_at: new Date().toISOString(),
        scopes: SCOPES,
        expires_at: body.expires_in ? new Date(Date.now() + body.expires_in * 1000).toISOString() : null,
    });
}

// After consent, find which Google Ads accounts this login can reach. Returns
// resource names like "customers/1234567890". A Manager login returns its
// clients too; the sync skips accounts that error on a metrics query.
export async function listAccessibleCustomers(accessToken) {
    const url = `${apiBase()}/${apiVersion()}/customers:listAccessibleCustomers`;
    // No login-customer-id: this lists the credential's own accounts; an MCC
    // header makes Google reject it with INVALID_ARGUMENT.
    const res = await fetch(url, { headers: adsHeaders(accessToken, { withLogin: false }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
        const msg = body?.error?.message || `listAccessibleCustomers HTTP ${res.status}`;
        throw new Error(msg);
    }
    return (body.resourceNames ?? []).map((rn) => String(rn).split('/')[1]).filter(Boolean);
}

export const GoogleAdsProvider = {
    async authorize(orgId) {
        if (!process.env.GOOGLE_ADS_CLIENT_ID) throw new Error('GOOGLE_ADS_CLIENT_ID is not configured');
        const { signState } = await import('../oauth-state.js');
        const state = signState({ orgId, provider: 'google_ads' });
        const url = new URL(AUTHORIZE_URL);
        url.searchParams.set('response_type', 'code');
        url.searchParams.set('client_id', process.env.GOOGLE_ADS_CLIENT_ID);
        url.searchParams.set('scope', SCOPES.join(' '));
        url.searchParams.set('redirect_uri', redirectUri());
        url.searchParams.set('state', state);
        // offline + consent are REQUIRED to receive a refresh_token (Google only
        // returns one on first consent unless prompt=consent forces re-issue).
        url.searchParams.set('access_type', 'offline');
        url.searchParams.set('prompt', 'consent');
        url.searchParams.set('include_granted_scopes', 'true');
        await integrationsRepository.upsert(orgId, 'google_ads', { status: 'pending' });
        return { redirectUrl: url.toString() };
    },

    async callback(orgId, { code }) {
        const { GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET } = process.env;
        if (!GOOGLE_ADS_CLIENT_ID || !GOOGLE_ADS_CLIENT_SECRET) throw new Error('Google Ads OAuth env vars missing');
        if (!code) throw new Error('Missing authorization code');

        const res = await fetch(TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                code,
                client_id: GOOGLE_ADS_CLIENT_ID,
                client_secret: GOOGLE_ADS_CLIENT_SECRET,
                redirect_uri: redirectUri(),
            }).toString(),
        });
        const body = await res.json();
        if (!res.ok) {
            await integrationsRepository.markFailed(orgId, 'google_ads', body.error_description ?? body.error ?? 'oauth_failed');
            throw new Error(body.error_description ?? 'Google Ads OAuth exchange failed');
        }
        if (!body.refresh_token) {
            // No refresh token => offline access was not granted; periodic sync
            // would die in an hour. Fail loud so the owner re-consents.
            await integrationsRepository.markFailed(orgId, 'google_ads', 'no refresh_token (re-consent with offline access)');
            throw new Error('Google did not return a refresh token. Disconnect and reconnect to grant offline access.');
        }
        // Discover the accounts this login can reach. Two distinct failures, both
        // surfaced (never swallowed — a swallowed error here once hid a sunset API
        // version for an entire debug session):
        //   - throw  => API/permission problem (bad dev token, sunset version).
        //   - []      => the Google account that consented has NO Google Ads
        //               account. The owner picked the wrong email. Signal it with
        //               the NO_AD_ACCOUNT code so the UI can show a clear dialog.
        let customerIds = [];
        try {
            customerIds = await listAccessibleCustomers(body.access_token);
        } catch (err) {
            await integrationsRepository.markFailed(orgId, 'google_ads', `account_lookup_failed: ${err.message}`);
            throw new Error(`Could not list Google Ads accounts: ${err.message}`);
        }
        if (customerIds.length === 0) {
            await integrationsRepository.markFailed(orgId, 'google_ads', 'NO_AD_ACCOUNT');
            throw new Error('NO_AD_ACCOUNT');
        }
        await persistTokenResponse(orgId, body, { customer_ids: customerIds });
        // Seed the account dimension with the ids; the sync enriches each row
        // with descriptive_name + currency from the customer resource. Selection
        // defaults to all-selected.
        try {
            await integrationsRepository.upsertAdAccounts(orgId, 'google_ads',
                customerIds.map((id) => ({ customer_id: id })));
        } catch (err) {
            console.error('[google_ads] ad_accounts upsert failed:', err.message);
        }
        return { ok: true, customerIds };
    },

    async refresh(orgId) {
        const { GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET } = process.env;
        if (!GOOGLE_ADS_CLIENT_ID || !GOOGLE_ADS_CLIENT_SECRET) throw new Error('Google Ads OAuth env vars missing');

        const claimed = await integrationsRepository.claimRefresh(orgId, 'google_ads');
        if (!claimed) return { skipped: 'refresh_in_progress' };
        try {
            const integration = await integrationsRepository.getByProvider(orgId, 'google_ads');
            if (!integration?.secrets) throw new Error('No stored credentials to refresh');
            const { refresh_token } = JSON.parse(decryptSecret(integration.secrets));
            if (!refresh_token) throw new Error('No refresh_token stored');

            const res = await fetch(TOKEN_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
                body: new URLSearchParams({
                    grant_type: 'refresh_token',
                    refresh_token,
                    client_id: GOOGLE_ADS_CLIENT_ID,
                    client_secret: GOOGLE_ADS_CLIENT_SECRET,
                }).toString(),
            });
            const body = await res.json();
            if (!res.ok) {
                await integrationsRepository.markFailed(orgId, 'google_ads', body.error_description ?? body.error ?? 'refresh_failed');
                throw new Error(body.error_description ?? 'Google Ads token refresh failed');
            }
            // Refresh responses carry no refresh_token — preserve the stored one.
            await persistTokenResponse(orgId, body, {
                ...(integration.config ?? {}),
                __refresh_token: refresh_token,
            });
            return { ok: true };
        } finally {
            await integrationsRepository.clearRefresh(orgId, 'google_ads');
        }
    },

    async revoke(orgId) {
        await integrationsRepository.markRevoked(orgId, 'google_ads');
        return { ok: true };
    },

    async webhook() {
        // Google Ads has no inbound webhook for spend; sync is the poll path.
        return { received: true };
    },

    async sync(orgId, integrationArg, onProgress, opts) {
        const { syncOneOrg } = await import('./google-ads-sync.js');
        return syncOneOrg(orgId, integrationArg, onProgress, opts);
    },
};

registerProvider(
    { id: 'google_ads', label: 'Google Ads', authStyle: 'oauth', category: 'marketing' },
    GoogleAdsProvider,
);
