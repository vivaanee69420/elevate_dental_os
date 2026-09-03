// ============================================================================
// CallRail provider — key verification only.
//
// CallRail has no singleton key-paste connect route of its own: the owner
// holds one API key per CallRail company, one company per practice, exactly
// like GoHighLevel multi-subaccount — every credential lives on an
// integration_accounts row (see callrail.service.js, Task 4), never on the
// single `integrations` marker row this module's siblings use. This file's
// only job is to resolve a pasted API key + CallRail account id against
// CallRail's own account endpoint BEFORE it is ever persisted, so a bad key
// is rejected at connect time with a clear message instead of stored and
// failing silently every night.
//
// NOT registered with provider-interface.js's registerProvider(): this isn't
// an IntegrationProvider (no authorize/callback/refresh/webhook/sync) — it is
// a plain verification helper, the same shape as emergent-sync.js's
// verifyCredentials for a provider with its own dedicated service+routes.
//
// SECURITY: the thrown message is shown to the owner verbatim by the panel
// and must never contain the raw key, in any branch.
// ============================================================================

const API_BASE = 'https://api.callrail.com/v3';

// Resolve a CallRail API key + account id against CallRail's own account
// endpoint. Returns the account's own `name` on success; throws an Error
// with a message safe to show the owner on any failure (network error, bad
// key, unknown account, or an empty/malformed response).
export async function verify(apiKey, callrailAccountId) {
    const key = apiKey == null ? '' : String(apiKey).trim();
    const accountId = callrailAccountId == null ? '' : String(callrailAccountId).trim();
    if (!key) throw new Error('A CallRail API key is required');
    if (!accountId) throw new Error('A CallRail account ID is required');

    const url = `${API_BASE}/a/${encodeURIComponent(accountId)}.json`;
    let res;
    try {
        res = await fetch(url, {
            headers: { Authorization: `Token token="${key}"`, Accept: 'application/json' },
        });
    } catch {
        // Network-level failure (DNS, timeout, connection reset, ...). Never
        // surface the caught error's own message here — it can carry request
        // internals — a fixed, generic message is the safe choice.
        throw new Error('Could not reach CallRail. Check your connection and try again.');
    }

    if (res.status === 401 || res.status === 403) {
        throw new Error(`CallRail rejected this API key for account ${accountId}. Check the key and account ID and try again.`);
    }
    if (res.status === 404) {
        throw new Error(`CallRail account ${accountId} was not found. Check the account ID and try again.`);
    }
    if (!res.ok) {
        throw new Error(`CallRail could not verify this key right now (HTTP ${res.status}). Try again shortly.`);
    }

    const json = await res.json().catch(() => ({}));
    const name = json?.name;
    if (!name || typeof name !== 'string') {
        throw new Error(`CallRail did not return an account name for ${accountId}. Check the account ID and try again.`);
    }
    return name;
}

export const callrailProvider = { verify };
