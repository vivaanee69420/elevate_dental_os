// QuickBooks Online OAuth2 provider — MULTI-ACCOUNT. One org can connect N QBO
// companies; each company is one integration_accounts row keyed by realmId and
// carries its own rotating token pair. The single `integrations` 'quickbooks'
// row stays a lightweight connected marker (gating + the generic syncNow secrets
// gate). Mirrors xero-provider.js for the OAuth handshake; Xero stays a parallel
// accounting source (both write monthly_financials, keyed by `source`).
//
//   authorize → appcenter.intuit.com/connect/oauth2     (scope com.intuit.quickbooks.accounting)
//   token     → oauth.platform.intuit.com/.../bearer    (HTTP Basic client auth)
//   company   → realmId arrives on the CALLBACK query (no connections call)
//   callback  → PUBLIC /oauth/quickbooks/callback (orgId from signed state)
//
// Access tokens live 1 hour; refresh tokens live ~100 days and ROTATE (a new
// refresh_token may come back on refresh) — same single-use race as Xero/GHL,
// so we claim the account row before refreshing (claimRefresh).

import { registerProvider } from './provider-interface.js';
import { integrationRepository as integrationsRepository } from '../../repositories/integration.repository.js';
import { integrationAccountRepository } from '../../repositories/integration-account.repository.js';
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

// Best-effort QBO company display name for the connected realm (the account is
// still created with a fallback label if this lookup fails).
async function fetchCompanyName(realmId, accessToken) {
    try {
        const base = process.env.QUICKBOOKS_API_BASE || 'https://quickbooks.api.intuit.com';
        const res = await fetch(`${base}/v3/company/${realmId}/companyinfo/${realmId}?minorversion=65`, {
            headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
        });
        if (!res.ok) return null;
        const json = await res.json();
        return json?.CompanyInfo?.CompanyName ?? null;
    } catch { return null; }
}

// Persist the token pair onto a per-company account row (upsert by realmId), and
// keep the marker `integrations` row active with a non-null sentinel secret so
// the generic syncNow/refresh secrets gate passes. Returns the account id.
async function persistAccount(orgId, body, realmId, companyName) {
    const secrets = encryptSecret(JSON.stringify({
        access_token: body.access_token,
        refresh_token: body.refresh_token,
    }));
    const accountId = await integrationAccountRepository.upsertByExternalId(orgId, 'quickbooks', realmId, {
        label: companyName || 'QuickBooks',
        secrets,
        status: 'active',
        config: {
            realm_id: realmId,
            company_name: companyName ?? null,
            token_type: body.token_type,
            scope: body.scope,
            expires_at: body.expires_in ? new Date(Date.now() + body.expires_in * 1000).toISOString() : null,
            refreshing: false,
        },
    });
    await integrationsRepository.upsertSecrets(orgId, 'quickbooks', {
        config: { multi_account: true },
        secrets: encryptSecret(JSON.stringify({ marker: true })),
        status: 'active',
        verified_at: new Date().toISOString(),
        scopes: SCOPES,
        expires_at: null,
    });
    return accountId;
}

// Refresh ONE company account's rotating token. Claims the account first
// (single-use refresh race), persists the new pair back. Exported for the sync's
// ensureAccountToken.
export async function refreshAccountToken(orgId, accountId) {
    const { QUICKBOOKS_CLIENT_ID, QUICKBOOKS_CLIENT_SECRET } = process.env;
    if (!QUICKBOOKS_CLIENT_ID || !QUICKBOOKS_CLIENT_SECRET) throw new Error('QuickBooks OAuth env vars missing');
    const claimed = await integrationAccountRepository.claimRefresh(orgId, accountId);
    if (!claimed) return { skipped: 'refresh_in_progress' };
    try {
        const account = await integrationAccountRepository.getByIdWithSecrets(orgId, accountId);
        if (!account?.secrets) throw new Error('No stored credentials to refresh');
        const { refresh_token } = JSON.parse(decryptSecret(account.secrets));
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
            await integrationAccountRepository.markFailed(orgId, accountId, body.error_description ?? body.error ?? 'refresh_failed');
            throw new Error(body.error_description ?? 'QuickBooks token refresh failed');
        }
        await persistAccount(orgId, body, account.config?.realm_id ?? null, account.config?.company_name ?? null);
        return { ok: true };
    } finally {
        await integrationAccountRepository.clearRefresh(orgId, accountId);
    }
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
        // Don't flip the marker to 'pending' once companies are already connected —
        // a second "Connect a company" must not blank the existing connection.
        const existing = await integrationsRepository.getByProvider(orgId, 'quickbooks');
        if (!existing || existing.status !== 'active') {
            await integrationsRepository.upsert(orgId, 'quickbooks', { status: 'pending' });
        }
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
        const companyName = await fetchCompanyName(realmId, body.access_token);
        const accountId = await persistAccount(orgId, body, realmId, companyName);
        // First connect = full 12mo backfill for this company. Fire-and-forget.
        const { syncAccount } = await import('./quickbooks-sync.js');
        syncAccount(orgId, accountId, () => {}, { full: true })
            .catch((e) => console.error('[quickbooks] first sync failed:', e?.message || e));
        return { ok: true, accountId };
    },

    // Refresh every active QB company for the org (the generic
    // integration.service.refresh(orgId, 'quickbooks') path has no account id).
    async refresh(orgId, accountId) {
        if (accountId) return refreshAccountToken(orgId, accountId);
        const accounts = await integrationAccountRepository.list(orgId, 'quickbooks');
        const results = [];
        for (const a of accounts.filter((x) => x.status === 'active')) {
            try { results.push({ accountId: a.id, ...(await refreshAccountToken(orgId, a.id)) }); }
            catch (e) { results.push({ accountId: a.id, error: e.message }); }
        }
        return { ok: true, results };
    },

    // Global disconnect: revoke the marker + every company account row.
    async revoke(orgId) {
        const accounts = await integrationAccountRepository.list(orgId, 'quickbooks');
        for (const a of accounts) {
            try { await integrationAccountRepository.markRevoked(orgId, a.id); } catch { /* best-effort */ }
        }
        await integrationsRepository.markRevoked(orgId, 'quickbooks');
        return { ok: true };
    },

    async webhook() {
        // QuickBooks supports webhooks for entity events; deferred. Sync is the poll path.
        return { received: true };
    },

    async sync(orgId) {
        const { syncAllAccounts } = await import('./quickbooks-sync.js');
        return syncAllAccounts(orgId);
    },
};

registerProvider(
    { id: 'quickbooks', label: 'QuickBooks', authStyle: 'oauth', category: 'accounting' },
    QuickBooksProvider,
);
