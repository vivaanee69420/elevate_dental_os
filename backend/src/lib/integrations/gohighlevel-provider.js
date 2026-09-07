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
// An OAuth consent authorises ONE Location, so a connection is stored as a row
// in integration_accounts — the same place a pasted Private Integration Token
// lands — NOT on the single `integrations` marker row. That row is all the
// nightly worker iterates (syncAllOrgs → listAllSyncable), so tokens written to
// the marker would authenticate, read "Connected", and never be synced by
// anything. `config.auth = 'oauth'` is what tells the sync this row's token
// expires (~24h) and must be refreshed before use; a PIT row has no
// refresh_token and is left alone.
//
// Fallback: when GHL_CLIENT_ID is unset (OAuth not configured on this server),
// authorize() returns the key-paste prompt and callback() accepts { apiKey,
// locationId } exactly as before — existing API-key connections keep working.

import crypto from 'node:crypto';
import { registerProvider } from './provider-interface.js';
import { integrationRepository as integrationsRepository } from '../../repositories/integration.repository.js';
import { integrationAccountRepository } from '../../repositories/integration-account.repository.js';
import { encryptSecret, decryptSecret } from '../crypto.js';

// Public redirect slug — must avoid "highlevel"/"ghl" (GHL marketplace blocks
// those in the redirect URI). Aliased back to 'gohighlevel' in the controller.
export const OAUTH_SLUG = 'leadconnector';

// Exactly what the OAuth token is used for and nothing more: contacts,
// opportunities and workflows for the sync's four phases, calendars plus their
// events for the appointments phase, conversations for the Inbox pull, and
// locations to name the subaccount on connect.
//
// One write scope, and it is load-bearing: replying from the Inbox posts to
// POST /conversations/messages as the contact's own subaccount, so without
// conversations/message.write an OAuth connection can read the whole
// conversation and not answer it. Every other scope is read-only.
const DEFAULT_SCOPES = [
    'contacts.readonly',
    'opportunities.readonly',
    'locations.readonly',
    'workflows.readonly',
    'calendars.readonly',
    'calendars/events.readonly',
    'conversations.readonly',
    'conversations/message.readonly',
    'conversations/message.write',
].join(' ');

const PASTE_HINT =
    'Paste a GoHighLevel Private Integration Token (Settings → Private Integrations → create a token with View Contacts, View Opportunities, View Conversations and Edit Conversation Messages — the last one is what lets you reply from the Inbox) and your Location ID (Settings → Business Info). Note: the legacy JWT "API Key" targets the old v1 API and will not work here.';

function backendUrl() {
    return process.env.BACKEND_PUBLIC_URL || 'http://localhost:8080';
}
function redirectUri() {
    return `${backendUrl()}/oauth/${OAUTH_SLUG}/callback`;
}
function authBase() {
    return process.env.GHL_AUTH_BASE || 'https://marketplace.gohighlevel.com';
}

// The VERSIONED consent path. GHL's marketplace serves four routes —
// /oauth/chooselocation, /v1/... and /v2/... — and the unversioned one is the
// v1 endpoint: it looks the client id up as a legacy "integration" and answers
// `No integration found with the id: <id>` for any app created on the current
// marketplace, which is every app anyone can make today. GHL's own
// InstallLinkBanner (the install link shown in app settings) builds /v2, so
// that is what a working link looks like.
//
// Overridable because this is the second time the path has moved.
function chooseLocationPath() {
    return process.env.GHL_AUTHORIZE_PATH || '/v2/oauth/chooselocation';
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

const API_BASE = 'https://services.leadconnectorhq.com';
const API_VERSION = '2021-07-28';

// The marketplace app id is the client id's first segment — the same id GHL
// names in "No integration found with the id: <id>".
function appId() {
    return String(process.env.GHL_CLIENT_ID ?? '').split('-')[0];
}

async function ghlOAuthGet(path, agencyToken) {
    const res = await fetch(`${API_BASE}${path}`, {
        headers: {
            Authorization: `Bearer ${agencyToken}`,
            Version: API_VERSION,
            Accept: 'application/json',
        },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(body.message || body.error_description || `GoHighLevel ${res.status}`);
    }
    return body;
}

/**
 * The Locations this agency installed the app into.
 *
 * An agency-level consent authorises the COMPANY, not a Location, so the token
 * response carries companyId and no locationId. This is how the one consent
 * becomes N subaccounts.
 */
export async function listInstalledLocations(agencyToken, companyId) {
    const qs = new URLSearchParams({ companyId: String(companyId), appId: appId() });
    const body = await ghlOAuthGet(`/oauth/installedLocations?${qs}`, agencyToken);
    const rows = body.locations ?? body.data ?? [];
    return rows
        .map((l) => ({ id: String(l._id ?? l.id ?? ''), name: l.name ?? null }))
        .filter((l) => l.id);
}

/**
 * Mint a Location access token from an agency token.
 *
 * These are the credentials an agency install actually syncs with, and they
 * carry NO refresh token of their own — they are re-minted from the agency
 * token, which is the thing that refreshes. That is why an agency-install
 * subaccount stores `auth: 'oauth_company'` and the agency token stays on the
 * org's `integrations` row: one renewable credential, N derived ones.
 */
export async function mintLocationToken(agencyToken, companyId, locationId) {
    const res = await fetch(`${API_BASE}/oauth/locationToken`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${agencyToken}`,
            Version: API_VERSION,
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ companyId: String(companyId), locationId: String(locationId) }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.access_token) {
        throw new Error(body.message || body.error_description || `GoHighLevel ${res.status} minting a location token`);
    }
    return body;
}

/**
 * A live agency access token for this org, refreshing it first if it is spent.
 *
 * The agency token lives on the `integrations` row because it belongs to the
 * COMPANY, not to any one Location — every subaccount row derives from it.
 */
export async function ensureAgencyToken(orgId) {
    const row = await integrationsRepository.getByProvider(orgId, 'gohighlevel');
    if (!row?.secrets) return null;
    let secrets;
    try { secrets = JSON.parse(decryptSecret(row.secrets)); } catch { return null; }
    if (!secrets.refresh_token) return null;
    const expiresAt = row.expires_at ? Date.parse(row.expires_at) : 0;
    if (Number.isFinite(expiresAt) && expiresAt - Date.now() > AGENCY_TOKEN_SKEW_MS) {
        return secrets.access_token;
    }
    await GoHighLevelProvider.refresh(orgId);
    const fresh = await integrationsRepository.getByProvider(orgId, 'gohighlevel');
    try { return JSON.parse(decryptSecret(fresh.secrets)).access_token; } catch { return null; }
}

const AGENCY_TOKEN_SKEW_MS = 10 * 60 * 1000;

/** Exchange a refresh token. Exported so gohighlevel-sync can refresh a
 *  subaccount's token without a second copy of the client credentials, the
 *  endpoint, or GHL's form-encoding requirement. */
export async function exchangeRefreshToken(refreshToken) {
    return postToken({ grant_type: 'refresh_token', refresh_token: refreshToken });
}

/**
 * Store an OAuth connection as a SUBACCOUNT ROW, not on the `integrations`
 * marker row.
 *
 * The nightly worker iterates integration_accounts and never reads the marker
 * row (syncAllOrgs → listAllSyncable). Writing tokens there would have produced
 * a connection that authenticates, shows "Connected", and is never synced by
 * anything — the failure shape where a green badge hides an empty account.
 *
 * One consent = one Location, which is exactly what adding a Private
 * Integration Token does today, so OAuth and PIT accounts sit side by side and
 * the sync cannot tell them apart. `config.auth` records which it is, because
 * only an OAuth row has a token worth refreshing.
 */
async function persistOAuthAccount(orgId, body, { label: labelOverride = null } = {}) {
    const locationId = body.locationId ? String(body.locationId) : null;
    if (!locationId) {
        throw new Error('GoHighLevel did not return a locationId for this authorisation');
    }
    const secrets = encryptSecret(JSON.stringify({
        access_token: body.access_token,
        refresh_token: body.refresh_token ?? null,
    }));
    const config = {
        // 'oauth' — this row holds its own renewable token (a Location
        // consent). 'oauth_company' — it does not: its token is minted from the
        // agency token on the org's `integrations` row, because an agency
        // consent produces one renewable credential and N derived ones.
        auth: body.refresh_token ? 'oauth' : 'oauth_company',
        companyId: body.companyId ? String(body.companyId) : null,
        userType: body.userType ?? null,
        // Not a secret, and the sync needs it before every run.
        expires_at: body.expires_in
            ? new Date(Date.now() + body.expires_in * 1000).toISOString()
            : null,
    };

    // Re-authorising an already-connected Location must UPDATE it, keeping its
    // practice mapping and webhook token — a second row would double every
    // figure that location contributes.
    const existing = await integrationAccountRepository.getByLocation(orgId, 'gohighlevel', locationId);
    if (existing) {
        return integrationAccountRepository.update(orgId, existing.id, {
            secrets,
            status: 'active',
            last_error: null,
            config: { ...(existing.config ?? {}), ...config },
        });
    }
    let label = labelOverride || 'GoHighLevel';
    if (!labelOverride) {
        try {
            const { fetchLocation } = await import('./gohighlevel-sync.js');
            label = (await fetchLocation(body.access_token, locationId))?.name || label;
        } catch {
            // A naming call must never fail a connection that already authenticated.
        }
    }
    return integrationAccountRepository.insert(orgId, {
        provider: 'gohighlevel',
        external_account_id: locationId,
        label,
        secrets,
        config,
        status: 'active',
        webhook_token: crypto.randomBytes(24).toString('hex'),
    });
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

/**
 * Turn ONE agency consent into a subaccount per installed Location.
 *
 * The agency token is stored on the org's `integrations` row — it belongs to
 * the company, not to any Location, and it is the only credential here that
 * refreshes. Each Location then gets an `integration_accounts` row exactly like
 * a token or Location-consent subaccount, so everything downstream (the
 * nightly sync, the Inbox reply path, the practice mapping) is unchanged.
 *
 * A Location that fails to mint is REPORTED, not skipped silently: the others
 * still connect, and the owner learns which one needs attention.
 */
async function finishAgencyConnect(orgId, body) {
    await persistTokens(orgId, body);
    const companyId = String(body.companyId);

    let locations = [];
    try {
        locations = await listInstalledLocations(body.access_token, companyId);
        console.log(`[gohighlevel] agency ${companyId}: ${locations.length} installed location(s)`,
            JSON.stringify(locations.map((l) => l.name ?? l.id)));
    } catch (err) {
        await integrationsRepository.markFailed(orgId, 'gohighlevel', err.message);
        throw new Error(`Connected to the agency, but could not list its locations: ${err.message}`);
    }
    if (locations.length === 0) {
        // The consent worked; the app just is not on any sub-account yet, and
        // that is a thing the owner fixes in GoHighLevel, not a failure here.
        await integrationsRepository.upsert(orgId, 'gohighlevel', { status: 'active', last_error: null });
        return { ok: true, companyId, accounts: [], locations: 0 };
    }

    const accounts = [];
    const failed = [];
    for (const loc of locations) {
        try {
            const token = await mintLocationToken(body.access_token, companyId, loc.id);
            const account = await persistOAuthAccount(orgId, {
                ...token,
                locationId: token.locationId ?? loc.id,
                companyId,
                // A minted Location token has no refresh token of its own —
                // that is what makes this row 'oauth_company'.
                refresh_token: null,
            }, { label: loc.name || undefined });
            accounts.push(account.id);
        } catch (err) {
            console.error(`[gohighlevel] location ${loc.id} could not be connected:`, err?.message || err);
            failed.push(`${loc.name || loc.id}: ${err.message}`);
        }
    }

    await integrationsRepository.upsert(orgId, 'gohighlevel', {
        status: 'active',
        last_error: failed.length ? `Could not connect: ${failed.join('; ')}` : null,
    });

    import('./gohighlevel-sync.js')
        .then(({ bootstrapAccount }) => Promise.allSettled(accounts.map((id) => bootstrapAccount(orgId, id))))
        .catch((err) => console.error('[gohighlevel] agency bootstrap failed:', err?.message || err));

    if (accounts.length === 0) {
        throw new Error(`Connected to the agency, but no location could be connected. ${failed.join('; ')}`);
    }
    return { ok: true, companyId, accounts, locations: locations.length, failed };
}

export const GoHighLevelProvider = {
    async authorize(orgId, extra = {}) {
        // Key-paste when OAuth isn't configured on this server, and also when
        // the owner explicitly picks it: a Private Integration Token stays a
        // first-class way to add a subaccount once OAuth exists, because a
        // token is the only option for a location the owner cannot consent to
        // themselves. Same `method: 'key'` contract Dentally's hybrid uses.
        if (!oauthConfigured() || extra.method === 'key') {
            await integrationsRepository.upsert(orgId, 'gohighlevel', { status: 'pending' });
            return { requiresKeyPaste: true, requiresLocationId: true, pasteHint: PASTE_HINT };
        }
        const { signState } = await import('../oauth-state.js');
        // Sign with the INTERNAL provider key so verifyState matches after the
        // controller aliases the leadconnector slug back to gohighlevel.
        const state = signState({ orgId, provider: 'gohighlevel' });
        const url = new URL(`${authBase()}${chooseLocationPath()}`);
        url.searchParams.set('response_type', 'code');
        url.searchParams.set('client_id', process.env.GHL_CLIENT_ID);
        url.searchParams.set('redirect_uri', redirectUri());
        url.searchParams.set('scope', scopes());
        url.searchParams.set('state', state);
        // GHL's own install link carries the app version id. It is not
        // documented as required and connections work without it, so it is sent
        // only when the operator supplies it — copied from the install link in
        // the app's settings.
        if (process.env.GHL_APP_VERSION_ID) {
            url.searchParams.set('version_id', process.env.GHL_APP_VERSION_ID);
        }
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
            // What GHL sent, minus the credentials. Two rounds of this
            // connection failed on a response nobody had recorded — the token
            // body is the one piece of evidence that says which flow this is,
            // and it is unreachable after the redirect.
            console.log('[gohighlevel] token response:', JSON.stringify({
                keys: Object.keys(body).sort(),
                userType: body.userType ?? null,
                hasLocationId: Boolean(body.locationId),
                hasCompanyId: Boolean(body.companyId),
                hasRefreshToken: Boolean(body.refresh_token),
                expires_in: body.expires_in ?? null,
                scope: body.scope ?? null,
            }));
            // AGENCY consent. Installing the app on the agency authorises the
            // COMPANY, not a Location, so GHL returns companyId and no
            // locationId — which is the natural flow for an agency with many
            // sub-accounts, and the one that used to dead-end here. The agency
            // token is renewable and lives on the org's `integrations` row;
            // each installed Location becomes a subaccount whose token is
            // minted from it.
            if (!body.locationId && body.companyId) {
                return finishAgencyConnect(orgId, body);
            }
            if (!body.locationId) {
                // Name what DID come back — a bare "no locationId" cannot be
                // acted on, and the two causes need opposite fixes.
                throw new Error(
                    'GoHighLevel returned neither a locationId nor a companyId for this authorisation '
                    + `(userType: ${body.userType ?? 'absent'}). Install the app into a sub-account, or on the agency.`,
                );
            }
            const account = await persistOAuthAccount(orgId, body);
            // The marker row is what the tile reads for "connected"; the
            // account row is what actually syncs.
            await integrationsRepository.upsert(orgId, 'gohighlevel', { status: 'active', last_error: null });
            // Same first pull the PIT path runs, and fire-and-forget for the
            // same reason: it runs for minutes and the UI polls progress.
            import('./gohighlevel-sync.js')
                .then(({ bootstrapAccount }) => bootstrapAccount(orgId, account.id))
                .catch((err) => console.error('[gohighlevel] oauth bootstrap failed:', err?.message || err));
            return { ok: true, locationId: body.locationId ?? null, accountId: account.id };
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
        // 'oauth_or_key' (not plain 'oauth') so the tile keeps its "Connect
        // with API key" option once OAuth is configured — declaring 'oauth'
        // would have made the token path unreachable for a FIRST connection,
        // since the tile's Connect button redirects immediately.
        authStyle: oauthConfigured() ? 'oauth_or_key' : 'broker_key',
        category: 'marketing',
    },
    GoHighLevelProvider,
);
