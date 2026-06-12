// GoHighLevel (LeadConnector) provider — OAuth2 marketplace flow, with a
// long-lived API-key (broker) connect kept as a fallback.
//
// OAuth is the primary path: the owner clicks Connect, consents in GHL, and we
// exchange the code for an access_token + refresh_token + the chosen locationId.
// One marketplace app (operator GHL_CLIENT_ID/GHL_CLIENT_SECRET) serves every
// org; all rows are keyed by organisation_id.
//
//   authorize → marketplace.gohighlevel.com/oauth/chooselocation  (redirect)
//   token     → services.leadconnectorhq.com/oauth/token          (code → tokens)
//   refresh   → same endpoint, grant_type=refresh_token (~24h access token)
//   callback  → PUBLIC /oauth/leadconnector/callback (orgId from signed state)
//
// IMPORTANT — the public redirect slug is `leadconnector`, NOT `gohighlevel`:
// GHL's marketplace rejects any redirect URI containing a "Highlevel"/"ghl"
// reference. The controller aliases `leadconnector` → `gohighlevel`, and we sign
// the OAuth state with the internal `gohighlevel` key so verifyState matches.
//
// The GHL sync reads secrets.access_token + config.locationId and refreshes via
// this provider's refresh() when expires_at is near — identical shape to the old
// API-key row, so no sync change is needed.
//
// Fallback: when GHL_CLIENT_ID is unset (OAuth not configured on this server),
// authorize() returns the key-paste prompt and callback() accepts { apiKey,
// locationId } exactly as before — existing API-key connections keep working.

import { registerProvider } from './provider-interface.js';
import { integrationRepository as integrationsRepository } from '../../repositories/integration.repository.js';
import { encryptSecret, decryptSecret } from '../crypto.js';

// Public redirect slug — must avoid "highlevel"/"ghl" (GHL marketplace blocks
// those in the redirect URI). Aliased back to 'gohighlevel' in the controller.
export const OAUTH_SLUG = 'leadconnector';

const DEFAULT_SCOPES = 'contacts.readonly opportunities.readonly locations.readonly';

const PASTE_HINT =
    'Paste a GoHighLevel Private Integration Token (Settings → Private Integrations → create a token with View Contacts + View Opportunities) and your Location ID (Settings → Business Info). Note: the legacy JWT "API Key" targets the old v1 API and will not work here.';

function backendUrl() {
    return process.env.BACKEND_PUBLIC_URL || 'http://localhost:8080';
}
function redirectUri() {
    return `${backendUrl()}/oauth/${OAUTH_SLUG}/callback`;
}
function authBase() {
    return process.env.GHL_AUTH_BASE || 'https://marketplace.gohighlevel.com';
}
function tokenUrl() {
    return process.env.GHL_TOKEN_URL || 'https://services.leadconnectorhq.com/oauth/token';
}
function scopes() {
    return (process.env.GHL_SCOPES || DEFAULT_SCOPES).trim();
}
function oauthConfigured() {
    return !!process.env.GHL_CLIENT_ID;
}

// POST the token endpoint (code exchange OR refresh) — form-urlencoded, as GHL
// requires. Returns the parsed token body or throws a clear error.
async function postToken(params) {
    const { GHL_CLIENT_ID, GHL_CLIENT_SECRET } = process.env;
    if (!GHL_CLIENT_ID || !GHL_CLIENT_SECRET) throw new Error('GoHighLevel OAuth env vars missing');
    const body = new URLSearchParams({
        client_id: GHL_CLIENT_ID,
        client_secret: GHL_CLIENT_SECRET,
        user_type: 'Location',
        ...params,
    });
    const res = await fetch(tokenUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: body.toString(),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.access_token) {
        const msg = json.error_description || json.error || json.message || `token HTTP ${res.status}`;
        throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    }
    return json; // { access_token, refresh_token, expires_in, scope, locationId, companyId, userType, token_type }
}

// Persist an OAuth token response. locationId/companyId come from GHL directly,
// so OAuth needs no manual Location ID paste. expires_at drives ensureFreshToken.
async function persistTokens(orgId, body, prevConfig = {}) {
    await integrationsRepository.upsertSecrets(orgId, 'gohighlevel', {
        config: {
            ...prevConfig,
            locationId: body.locationId ? String(body.locationId) : prevConfig.locationId,
            companyId: body.companyId ? String(body.companyId) : prevConfig.companyId,
            token_type: body.token_type ?? 'Bearer',
            userType: body.userType ?? prevConfig.userType,
        },
        secrets: encryptSecret(JSON.stringify({
            access_token: body.access_token,
            refresh_token: body.refresh_token ?? null,
        })),
        status: 'active',
        verified_at: new Date().toISOString(),
        scopes: body.scope ? body.scope.split(/\s+/).filter(Boolean) : undefined,
        expires_at: body.expires_in ? new Date(Date.now() + body.expires_in * 1000).toISOString() : null,
    });
}

export const GoHighLevelProvider = {
    async authorize(orgId) {
        // Fallback to key-paste when OAuth isn't configured on this server.
        if (!oauthConfigured()) {
            await integrationsRepository.upsert(orgId, 'gohighlevel', { status: 'pending' });
            return { requiresKeyPaste: true, requiresLocationId: true, pasteHint: PASTE_HINT };
        }
        const { signState } = await import('../oauth-state.js');
        // Sign with the INTERNAL provider key so verifyState matches after the
        // controller aliases the leadconnector slug back to gohighlevel.
        const state = signState({ orgId, provider: 'gohighlevel' });
        const url = new URL(`${authBase()}/oauth/chooselocation`);
        url.searchParams.set('response_type', 'code');
        url.searchParams.set('client_id', process.env.GHL_CLIENT_ID);
        url.searchParams.set('redirect_uri', redirectUri());
        url.searchParams.set('scope', scopes());
        url.searchParams.set('state', state);
        await integrationsRepository.upsert(orgId, 'gohighlevel', { status: 'pending' });
        return { redirectUrl: url.toString() };
    },

    // OAuth: { code } → exchange for tokens. Broker fallback: { apiKey, locationId }.
    async callback(orgId, payload = {}) {
        const { code, apiKey, locationId } = payload;
        if (code) {
            let body;
            try {
                body = await postToken({ grant_type: 'authorization_code', code, redirect_uri: redirectUri() });
            } catch (err) {
                await integrationsRepository.markFailed(orgId, 'gohighlevel', err.message);
                throw new Error(`GoHighLevel OAuth exchange failed: ${err.message}`);
            }
            await persistTokens(orgId, body);
            return { ok: true, locationId: body.locationId ?? null };
        }
        // Legacy broker key-paste path.
        if (!apiKey) throw new Error('GoHighLevel API key is required');
        if (!locationId) throw new Error('GoHighLevel Location ID is required');
        await integrationsRepository.upsertSecrets(orgId, 'gohighlevel', {
            config: { locationId: String(locationId).trim() },
            secrets: encryptSecret(JSON.stringify({ access_token: String(apiKey).trim() })),
            status: 'active',
            verified_at: new Date().toISOString(),
            expires_at: null, // long-lived API key — never refreshed on our side
        });
        return { ok: true };
    },

    // Roll the OAuth access token forward. No-op for a long-lived API-key row
    // (no refresh_token stored → nothing to rotate).
    async refresh(orgId) {
        const integration = await integrationsRepository.getByProvider?.(orgId, 'gohighlevel');
        if (!integration?.secrets) return { ok: true };
        let refresh_token = null;
        try { ({ refresh_token } = JSON.parse(decryptSecret(integration.secrets))); } catch { /* ignore */ }
        if (!refresh_token) return { ok: true }; // API key — nothing to refresh
        const claimed = await integrationsRepository.claimRefresh(orgId, 'gohighlevel');
        if (!claimed) return { skipped: 'refresh_in_progress' };
        try {
            let body;
            try {
                body = await postToken({ grant_type: 'refresh_token', refresh_token });
            } catch (err) {
                await integrationsRepository.markFailed(orgId, 'gohighlevel', err.message);
                throw err;
            }
            await persistTokens(orgId, body, integration.config ?? {});
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
        // Webhooks deferred; inbound is bootstrap-pull + hourly resync.
        return { received: true };
    },

    async sync(orgId) {
        const { syncOneOrg } = await import('./gohighlevel-sync.js');
        return syncOneOrg(orgId);
    },
};

registerProvider(
    {
        id: 'gohighlevel',
        label: 'GoHighLevel',
        authStyle: oauthConfigured() ? 'oauth' : 'broker_key',
        category: 'marketing',
    },
    GoHighLevelProvider,
);
