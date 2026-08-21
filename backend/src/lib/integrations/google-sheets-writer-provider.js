// Google Sheets WRITE connection — powers the GHL→Dentally conversion export.
// A deliberately SEPARATE provider row from 'google_sheets' (Call Reporting):
// that one stays spreadsheets.readonly; this one holds the full read/write
// spreadsheets scope and only ever touches the ONE destination sheet whose id
// the owner pastes (config.spreadsheet_id). No Drive scope — no file listing.
//
// Mirrors google-sheets-provider.js (same Google OAuth endpoints, refresh
// semantics, claim-guarded refresh, borrowed-redirect-URI logic). Env:
// GOOGLE_SHEETS_CLIENT_ID/SECRET, falling back to the Google Ads pair so one
// Google Cloud app can serve both providers (the Sheets API must be enabled
// on it). Tokens are AES-256-GCM encrypted at rest via crypto.js and NEVER
// surface in any API response (integration list strips secrets).

import { registerProvider } from './provider-interface.js';
import { integrationRepository as integrationsRepository } from '../../repositories/integration.repository.js';
import { encryptSecret, decryptSecret } from '../crypto.js';

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
// Full read/write spreadsheets scope — no Drive scope. The owner pastes the
// destination sheet URL; there is no file picker, so drive.file is not needed.
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
export const WRITER_PROVIDER_ID = 'google_sheets_writer';

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
// The redirect URI must be REGISTERED on the OAuth client in the Google Cloud
// Console. When borrowing the Google Ads client (no dedicated
// GOOGLE_SHEETS_CLIENT_ID), reuse the ALREADY-REGISTERED
// /oauth/google_ads/callback path so no console change is needed; with a
// dedicated Sheets client, reuse ITS already-registered
// /oauth/google_sheets/callback path (this provider does not get its own
// redirect URI). The signed OAuth state carries provider=google_sheets_writer
// and the public callback routes on the state, not the URL path.
function redirectUri() {
    const path = process.env.GOOGLE_SHEETS_CLIENT_ID ? 'google_sheets' : 'google_ads';
    return `${backendUrl()}/oauth/${path}/callback`;
}

async function persistTokenResponse(orgId, body, prevRefreshToken) {
    return integrationsRepository.upsertSecrets(orgId, WRITER_PROVIDER_ID, {
        // oauth_client_id records which Google client ISSUED this token, so a
        // process running with a different GOOGLE_SHEETS_CLIENT_* env (e.g. the
        // worker service missing the vars and falling back to the Ads pair)
        // fails fast with a config error instead of burning the integration.
        config: { token_type: body.token_type, scope: body.scope, oauth_client_id: clientId() },
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
    let integration = await integrationsRepository.getByProvider(orgId, WRITER_PROVIDER_ID);
    if (!integration || integration.status === 'revoked' || !integration.secrets) {
        throw new Error('Google Sheets (write) is not connected');
    }
    const nearExpiry = integration.expires_at
        && new Date(integration.expires_at).getTime() - Date.now() < 120_000;
    if (nearExpiry) {
        await GoogleSheetsWriterProvider.refresh(orgId);
        integration = await integrationsRepository.getByProvider(orgId, WRITER_PROVIDER_ID);
    }
    const { access_token } = JSON.parse(decryptSecret(integration.secrets));
    if (!access_token) throw new Error('No stored Google Sheets (write) access token');
    return access_token;
}

// Authenticated Sheets API call with bounded retry on 429/5xx and ONE
// refresh-and-retry on 401 (token invalidated server-side before expiry).
// JSON body when `body` is present (writes); otherwise a plain GET/other.
export async function writerFetch(orgId, path, { method = 'GET', params = {}, body } = {}) {
    const url = new URL(`${apiBase()}${path}`);
    for (const [k, v] of Object.entries(params)) {
        if (Array.isArray(v)) v.forEach((item) => url.searchParams.append(k, item));
        else if (v != null) url.searchParams.set(k, v);
    }
    let refreshed = false;
    let attempt = 0;
    for (;;) {
        const token = await getAccessToken(orgId);
        const headers = { Authorization: `Bearer ${token}` };
        const init = { method, headers };
        if (body !== undefined) {
            headers['Content-Type'] = 'application/json';
            init.body = JSON.stringify(body);
        }
        const res = await fetch(url, init);
        if (res.ok) return res.json();
        const resBody = await res.json().catch(() => ({}));
        if (res.status === 401 && !refreshed) {
            refreshed = true;
            await GoogleSheetsWriterProvider.refresh(orgId);
            continue;
        }
        if ((res.status === 429 || res.status >= 500) && attempt < 3) {
            attempt += 1;
            await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
            continue;
        }
        const msg = resBody?.error?.message || `Sheets API HTTP ${res.status}`;
        const err = new Error(msg);
        err.status = res.status;
        throw err;
    }
}

export const GoogleSheetsWriterProvider = {
    async authorize(orgId) {
        if (!clientId()) throw new Error('GOOGLE_SHEETS_CLIENT_ID is not configured');
        const { signState } = await import('../oauth-state.js');
        const state = signState({ orgId, provider: WRITER_PROVIDER_ID });
        const url = new URL(AUTHORIZE_URL);
        url.searchParams.set('response_type', 'code');
        url.searchParams.set('client_id', clientId());
        url.searchParams.set('scope', SCOPES.join(' '));
        url.searchParams.set('redirect_uri', redirectUri());
        url.searchParams.set('state', state);
        // offline + consent are REQUIRED to receive a refresh_token.
        url.searchParams.set('access_type', 'offline');
        url.searchParams.set('prompt', 'consent');
        await integrationsRepository.upsert(orgId, WRITER_PROVIDER_ID, { status: 'pending' });
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
            await integrationsRepository.markFailed(orgId, WRITER_PROVIDER_ID, body.error_description ?? body.error ?? 'oauth_failed');
            throw new Error(body.error_description ?? 'Google Sheets OAuth exchange failed');
        }
        if (!body.refresh_token) {
            await integrationsRepository.markFailed(orgId, WRITER_PROVIDER_ID, 'no refresh_token (re-consent with offline access)');
            throw new Error('Google did not return a refresh token. Disconnect and reconnect to grant offline access.');
        }
        await persistTokenResponse(orgId, body);
        return { ok: true };
    },

    async refresh(orgId) {
        if (!clientId() || !clientSecret()) throw new Error('Google Sheets OAuth env vars missing');
        const claimed = await integrationsRepository.claimRefresh(orgId, WRITER_PROVIDER_ID);
        if (!claimed) return { skipped: 'refresh_in_progress' };
        try {
            const integration = await integrationsRepository.getByProvider(orgId, WRITER_PROVIDER_ID);
            if (!integration?.secrets) throw new Error('No stored credentials to refresh');
            // Env-drift guard: refuse to present a token to a client that did
            // not issue it (Google answers 401 unauthorized_client, which used
            // to burn the row to 'failed' even though the token was fine).
            const issuedTo = integration.config?.oauth_client_id;
            if (issuedTo && issuedTo !== clientId()) {
                throw new Error(`Google Sheets OAuth env mismatch on this service: token was issued by client ${issuedTo.slice(0, 12)}… but this process is configured with ${clientId().slice(0, 12)}… — fix GOOGLE_SHEETS_CLIENT_ID/SECRET here`);
            }
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
                // Only invalid_grant means the refresh token itself is dead
                // (revoked/expired) — that needs the owner to reconnect, so
                // mark failed. invalid_client/unauthorized_client mean THIS
                // process has the wrong client env, and anything else is a
                // transient Google-side error: leave status untouched so a
                // correctly-configured process keeps the integration alive
                // (the drainer treats 'failed' as terminal).
                if (body.error === 'invalid_grant') {
                    await integrationsRepository.markFailed(orgId, WRITER_PROVIDER_ID, body.error_description ?? body.error);
                }
                const msg = (body.error === 'invalid_client' || body.error === 'unauthorized_client')
                    ? `Google Sheets OAuth client rejected (${body.error}) — GOOGLE_SHEETS_CLIENT_ID/SECRET on this service do not match the client that issued the stored token`
                    : (body.error_description ?? body.error ?? 'Google Sheets token refresh failed');
                throw new Error(msg);
            }
            await persistTokenResponse(orgId, body, refresh_token);
            return { ok: true };
        } finally {
            await integrationsRepository.clearRefresh(orgId, WRITER_PROVIDER_ID);
        }
    },

    async revoke(orgId) {
        await integrationsRepository.markRevoked(orgId, WRITER_PROVIDER_ID);
        return { ok: true };
    },

    async webhook() {
        // Google Sheets has no inbound webhook; sync is the poll/drain path.
        return { received: true };
    },

    async sync(orgId) {
        const { sheetExportService } = await import('../../services/sheet-export.service.js');
        return sheetExportService.drainOrg(orgId, { includeNoMatch: true });
    },
};

registerProvider(
    { id: WRITER_PROVIDER_ID, label: 'Google Sheets Export', authStyle: 'oauth', category: 'reporting' },
    GoogleSheetsWriterProvider,
);
