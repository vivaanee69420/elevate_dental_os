// Google Sheets OAuth2 provider — powers the Call Reporting dashboard.
// Mirrors google-ads-provider.js (same Google OAuth endpoints, refresh
// semantics, claim-guarded refresh) with two deliberate differences:
//
//   1. Scope is ONLY spreadsheets.readonly — a read-only, "sensitive" (not
//      "restricted") scope. We cannot write to or re-share the user's sheet,
//      and we skip drive.readonly entirely, so there is no sheet listing: the
//      owner pastes the sheet URL instead (sheet.service.addSource).
//   2. No developer token / MCC machinery — the Sheets API needs only OAuth.
//
// Env: GOOGLE_SHEETS_CLIENT_ID/SECRET, falling back to the Google Ads pair so
// one Google Cloud app can serve both (the Sheets API must be enabled on it).
// Tokens are AES-256-GCM encrypted at rest via crypto.js and NEVER surface in
// any API response (integration list strips secrets).

import { registerProvider } from './provider-interface.js';
import { integrationRepository as integrationsRepository } from '../../repositories/integration.repository.js';
import { encryptSecret, decryptSecret } from '../crypto.js';

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly'];
export const PROVIDER_ID = 'google_sheets';

function clientId() {
    return (process.env.GOOGLE_SHEETS_CLIENT_ID || process.env.GOOGLE_ADS_CLIENT_ID || '').trim();
}
function clientSecret() {
    return (process.env.GOOGLE_SHEETS_CLIENT_SECRET || process.env.GOOGLE_ADS_CLIENT_SECRET || '').trim();
}
function apiBase() {
    return process.env.GOOGLE_SHEETS_API_BASE || 'https://sheets.googleapis.com';
}
function backendUrl() {
    return process.env.BACKEND_PUBLIC_URL || 'http://localhost:8080';
}
function redirectUri() {
    return `${backendUrl()}/oauth/${PROVIDER_ID}/callback`;
}

// Accepts a full Sheets URL or a bare spreadsheet id. Returns the id or null.
// URL shape: https://docs.google.com/spreadsheets/d/<id>/edit#gid=0
export function parseSpreadsheetId(input) {
    const s = String(input ?? '').trim();
    if (!s) return null;
    const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{10,})/);
    if (m) return m[1];
    if (/^[a-zA-Z0-9_-]{10,}$/.test(s)) return s;
    return null;
}

async function persistTokenResponse(orgId, body, prevRefreshToken) {
    return integrationsRepository.upsertSecrets(orgId, PROVIDER_ID, {
        config: { token_type: body.token_type, scope: body.scope },
        secrets: encryptSecret(JSON.stringify({
            access_token: body.access_token,
            // Google omits refresh_token on a token *refresh* — keep the old one.
            refresh_token: body.refresh_token ?? prevRefreshToken,
        })),
        status: 'active',
        verified_at: new Date().toISOString(),
        scopes: SCOPES,
        expires_at: body.expires_in ? new Date(Date.now() + body.expires_in * 1000).toISOString() : null,
    });
}

// Valid access token for the org, refreshing when expired/near expiry.
export async function getAccessToken(orgId) {
    let integration = await integrationsRepository.getByProvider(orgId, PROVIDER_ID);
    if (!integration || integration.status === 'revoked' || !integration.secrets) {
        throw new Error('Google Sheets is not connected');
    }
    const nearExpiry = integration.expires_at
        && new Date(integration.expires_at).getTime() - Date.now() < 120_000;
    if (nearExpiry) {
        await GoogleSheetsProvider.refresh(orgId);
        integration = await integrationsRepository.getByProvider(orgId, PROVIDER_ID);
    }
    const { access_token } = JSON.parse(decryptSecret(integration.secrets));
    if (!access_token) throw new Error('No stored Google Sheets access token');
    return access_token;
}

// Authenticated Sheets API GET with bounded retry on 429/5xx and ONE
// refresh-and-retry on 401 (token invalidated server-side before expiry).
export async function sheetsFetch(orgId, path, params = {}) {
    const url = new URL(`${apiBase()}${path}`);
    for (const [k, v] of Object.entries(params)) {
        if (Array.isArray(v)) v.forEach((item) => url.searchParams.append(k, item));
        else if (v != null) url.searchParams.set(k, v);
    }
    let refreshed = false;
    let attempt = 0;
    for (;;) {
        const token = await getAccessToken(orgId);
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok) return res.json();
        const body = await res.json().catch(() => ({}));
        if (res.status === 401 && !refreshed) {
            refreshed = true;
            await GoogleSheetsProvider.refresh(orgId);
            continue;
        }
        if ((res.status === 429 || res.status >= 500) && attempt < 3) {
            attempt += 1;
            await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
            continue;
        }
        const msg = body?.error?.message || `Sheets API HTTP ${res.status}`;
        const err = new Error(msg);
        err.status = res.status;
        throw err;
    }
}

export const GoogleSheetsProvider = {
    async authorize(orgId) {
        if (!clientId()) throw new Error('GOOGLE_SHEETS_CLIENT_ID is not configured');
        const { signState } = await import('../oauth-state.js');
        const state = signState({ orgId, provider: PROVIDER_ID });
        const url = new URL(AUTHORIZE_URL);
        url.searchParams.set('response_type', 'code');
        url.searchParams.set('client_id', clientId());
        url.searchParams.set('scope', SCOPES.join(' '));
        url.searchParams.set('redirect_uri', redirectUri());
        url.searchParams.set('state', state);
        // offline + consent are REQUIRED to receive a refresh_token.
        url.searchParams.set('access_type', 'offline');
        url.searchParams.set('prompt', 'consent');
        await integrationsRepository.upsert(orgId, PROVIDER_ID, { status: 'pending' });
        return { redirectUrl: url.toString() };
    },

    async callback(orgId, { code }) {
        if (!clientId() || !clientSecret()) throw new Error('Google Sheets OAuth env vars missing');
        if (!code) throw new Error('Missing authorization code');
        const res = await fetch(TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                code,
                client_id: clientId(),
                client_secret: clientSecret(),
                redirect_uri: redirectUri(),
            }).toString(),
        });
        const body = await res.json();
        if (!res.ok) {
            await integrationsRepository.markFailed(orgId, PROVIDER_ID, body.error_description ?? body.error ?? 'oauth_failed');
            throw new Error(body.error_description ?? 'Google Sheets OAuth exchange failed');
        }
        if (!body.refresh_token) {
            await integrationsRepository.markFailed(orgId, PROVIDER_ID, 'no refresh_token (re-consent with offline access)');
            throw new Error('Google did not return a refresh token. Disconnect and reconnect to grant offline access.');
        }
        await persistTokenResponse(orgId, body);
        return { ok: true };
    },

    async refresh(orgId) {
        if (!clientId() || !clientSecret()) throw new Error('Google Sheets OAuth env vars missing');
        const claimed = await integrationsRepository.claimRefresh(orgId, PROVIDER_ID);
        if (!claimed) return { skipped: 'refresh_in_progress' };
        try {
            const integration = await integrationsRepository.getByProvider(orgId, PROVIDER_ID);
            if (!integration?.secrets) throw new Error('No stored credentials to refresh');
            const { refresh_token } = JSON.parse(decryptSecret(integration.secrets));
            if (!refresh_token) throw new Error('No refresh_token stored');
            const res = await fetch(TOKEN_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
                body: new URLSearchParams({
                    grant_type: 'refresh_token',
                    refresh_token,
                    client_id: clientId(),
                    client_secret: clientSecret(),
                }).toString(),
            });
            const body = await res.json();
            if (!res.ok) {
                await integrationsRepository.markFailed(orgId, PROVIDER_ID, body.error_description ?? body.error ?? 'refresh_failed');
                throw new Error(body.error_description ?? 'Google Sheets token refresh failed');
            }
            await persistTokenResponse(orgId, body, refresh_token);
            return { ok: true };
        } finally {
            await integrationsRepository.clearRefresh(orgId, PROVIDER_ID);
        }
    },

    async revoke(orgId) {
        await integrationsRepository.markRevoked(orgId, PROVIDER_ID);
        return { ok: true };
    },

    async webhook() {
        // Google Sheets has no inbound webhook; sync is the poll path.
        return { received: true };
    },

    async sync(orgId) {
        const { fullSync } = await import('./google-sheets-sync.js');
        return fullSync(orgId);
    },
};

registerProvider(
    { id: PROVIDER_ID, label: 'Google Sheets', authStyle: 'oauth', category: 'reporting' },
    GoogleSheetsProvider,
);
