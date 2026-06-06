// Meta (Facebook) Ads OAuth2 provider — full flow: authorize, code->token
// exchange, long-lived token upgrade, ad-account capture, token refresh, and a
// periodic spend/performance sync. Mirrors google-ads-provider.js. MULTI-TENANT:
// one Meta app (your META_APP_ID/META_APP_SECRET) serves every org; each org
// connects its OWN Meta ad accounts and all rows are keyed by organisation_id.
//
//   authorize  → facebook.com/<v>/dialog/oauth              (scope ads_read)
//   token      → graph.facebook.com/<v>/oauth/access_token  (code -> short-lived)
//   long-lived → same endpoint, grant_type=fb_exchange_token (~60-day token)
//   accounts   → graph.facebook.com/<v>/me/adaccounts
//   callback   → PUBLIC /oauth/meta_ads/callback (orgId from signed state)
//
// Meta has NO refresh_token (unlike Google/QuickBooks). A short-lived user token
// (~1-2h) is exchanged for a long-lived token (~60 days); refresh() re-runs
// fb_exchange_token on the stored long-lived token to roll the 60-day window
// forward (Meta only re-issues if the token is >24h old, so a daily call is
// safe). The Meta app id/secret are operator-level, NOT per-org.

import { registerProvider } from './provider-interface.js';
import { integrationRepository as integrationsRepository } from '../../repositories/integration.repository.js';
import { encryptSecret, decryptSecret } from '../crypto.js';

const SCOPES = ['ads_read'];

function graphBase() {
    return process.env.META_GRAPH_BASE || 'https://graph.facebook.com';
}
function apiVersion() {
    return process.env.META_API_VERSION || 'v21.0';
}
function authBase() {
    // The consent dialog lives on www.facebook.com, not the graph host.
    return process.env.META_AUTH_BASE || 'https://www.facebook.com';
}
function backendUrl() {
    return process.env.BACKEND_PUBLIC_URL || 'http://localhost:8080';
}
function redirectUri() {
    return `${backendUrl()}/oauth/meta_ads/callback`;
}

async function persistTokenResponse(orgId, body, configPatch = {}) {
    return integrationsRepository.upsertSecrets(orgId, 'meta_ads', {
        config: { token_type: body.token_type, ...configPatch },
        // Meta returns no refresh_token; the long-lived access_token IS the
        // durable credential. refresh() re-exchanges it before it expires.
        secrets: encryptSecret(JSON.stringify({ access_token: body.access_token })),
        status: 'active',
        verified_at: new Date().toISOString(),
        scopes: SCOPES,
        expires_at: body.expires_in ? new Date(Date.now() + body.expires_in * 1000).toISOString() : null,
    });
}

// Exchange a short-lived user token for a long-lived (~60-day) one. Same call
// is used by refresh() to roll the window forward on an existing long token.
async function exchangeForLongLived(shortToken) {
    const { META_APP_ID, META_APP_SECRET } = process.env;
    const url = new URL(`${graphBase()}/${apiVersion()}/oauth/access_token`);
    url.searchParams.set('grant_type', 'fb_exchange_token');
    url.searchParams.set('client_id', META_APP_ID);
    url.searchParams.set('client_secret', META_APP_SECRET);
    url.searchParams.set('fb_exchange_token', shortToken);
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
        const msg = body?.error?.message || body.error_description || `fb_exchange_token HTTP ${res.status}`;
        throw new Error(msg);
    }
    return body; // { access_token, token_type, expires_in }
}

// After consent, find which ad accounts this user can read. Returns numeric
// account ids (without the "act_" prefix the insights endpoint needs — the
// sync prepends it). Follows paging in the rare case a user has many accounts.
export async function listAdAccounts(accessToken) {
    let url = `${graphBase()}/${apiVersion()}/me/adaccounts?fields=account_id,name&limit=200&access_token=${encodeURIComponent(accessToken)}`;
    const ids = [];
    let guard = 0;
    while (url && guard < 25) {
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
            const msg = body?.error?.message || `me/adaccounts HTTP ${res.status}`;
            throw new Error(msg);
        }
        for (const a of body.data ?? []) {
            if (a.account_id) ids.push(String(a.account_id));
        }
        url = body.paging?.next || null;
        guard++;
    }
    return ids;
}

export const MetaAdsProvider = {
    async authorize(orgId) {
        if (!process.env.META_APP_ID) throw new Error('META_APP_ID is not configured');
        const { signState } = await import('../oauth-state.js');
        const state = signState({ orgId, provider: 'meta_ads' });
        const url = new URL(`${authBase()}/${apiVersion()}/dialog/oauth`);
        url.searchParams.set('response_type', 'code');
        url.searchParams.set('client_id', process.env.META_APP_ID);
        url.searchParams.set('scope', SCOPES.join(','));
        url.searchParams.set('redirect_uri', redirectUri());
        url.searchParams.set('state', state);
        await integrationsRepository.upsert(orgId, 'meta_ads', { status: 'pending' });
        return { redirectUrl: url.toString() };
    },

    async callback(orgId, { code }) {
        const { META_APP_ID, META_APP_SECRET } = process.env;
        if (!META_APP_ID || !META_APP_SECRET) throw new Error('Meta Ads OAuth env vars missing');
        if (!code) throw new Error('Missing authorization code');

        // 1) code -> short-lived user token. Meta's token endpoint is a GET with
        //    query params (not a form POST like Google).
        const tokUrl = new URL(`${graphBase()}/${apiVersion()}/oauth/access_token`);
        tokUrl.searchParams.set('client_id', META_APP_ID);
        tokUrl.searchParams.set('client_secret', META_APP_SECRET);
        tokUrl.searchParams.set('redirect_uri', redirectUri());
        tokUrl.searchParams.set('code', code);
        const res = await fetch(tokUrl, { headers: { Accept: 'application/json' } });
        const short = await res.json().catch(() => ({}));
        if (!res.ok || !short.access_token) {
            const msg = short?.error?.message || short.error_description || 'oauth_failed';
            await integrationsRepository.markFailed(orgId, 'meta_ads', msg);
            throw new Error(short?.error?.message || 'Meta Ads OAuth exchange failed');
        }

        // 2) short-lived -> long-lived (~60-day) token. Without this the sync
        //    would die in an hour or two.
        let longLived;
        try {
            longLived = await exchangeForLongLived(short.access_token);
        } catch (err) {
            await integrationsRepository.markFailed(orgId, 'meta_ads', `long-lived exchange failed: ${err.message}`);
            throw new Error(`Meta long-lived token exchange failed: ${err.message}`);
        }

        // 3) Discover the ad accounts this user can read; store for the sync.
        let accountIds = [];
        try {
            accountIds = await listAdAccounts(longLived.access_token);
        } catch (err) {
            // Non-fatal: token is valid; the user may lack ads_read on any
            // account. Persist anyway so the row is active; sync surfaces it.
            console.error('[meta_ads] listAdAccounts failed:', err.message);
        }
        await persistTokenResponse(orgId, longLived, { account_ids: accountIds });
        return { ok: true, accountIds };
    },

    async refresh(orgId) {
        const { META_APP_ID, META_APP_SECRET } = process.env;
        if (!META_APP_ID || !META_APP_SECRET) throw new Error('Meta Ads OAuth env vars missing');

        const claimed = await integrationsRepository.claimRefresh(orgId, 'meta_ads');
        if (!claimed) return { skipped: 'refresh_in_progress' };
        try {
            const integration = await integrationsRepository.getByProvider(orgId, 'meta_ads');
            if (!integration?.secrets) throw new Error('No stored credentials to refresh');
            const { access_token } = JSON.parse(decryptSecret(integration.secrets));
            if (!access_token) throw new Error('No access_token stored');

            let longLived;
            try {
                longLived = await exchangeForLongLived(access_token);
            } catch (err) {
                await integrationsRepository.markFailed(orgId, 'meta_ads', err.message);
                throw err;
            }
            // Preserve the discovered ad accounts across the token roll.
            await persistTokenResponse(orgId, longLived, { ...(integration.config ?? {}) });
            return { ok: true };
        } finally {
            await integrationsRepository.clearRefresh(orgId, 'meta_ads');
        }
    },

    async revoke(orgId) {
        await integrationsRepository.markRevoked(orgId, 'meta_ads');
        return { ok: true };
    },

    async webhook() {
        // No inbound webhook for ad spend; sync is the poll path.
        return { received: true };
    },

    async sync(orgId, integrationArg, onProgress, opts) {
        const { syncOneOrg } = await import('./meta-ads-sync.js');
        return syncOneOrg(orgId, integrationArg, onProgress, opts);
    },
};

registerProvider(
    { id: 'meta_ads', label: 'Meta Ads', authStyle: 'oauth', category: 'marketing' },
    MetaAdsProvider,
);
