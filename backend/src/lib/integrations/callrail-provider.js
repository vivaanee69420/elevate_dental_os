// ============================================================================
// CallRail provider — key + company verification, and the company lookup the
// Add-company form uses to let an owner PICK a company instead of typing one.
//
// CallRail's hierarchy is Account -> Company -> Calls (verified against the
// official v3 docs — see docs/superpowers/specs/2026-09-04-callrail-api-facts.md).
// `/v3/a/{id}` always takes the ACCOUNT id (shaped
// "ACC8154748ae6bd4e278a7cddd38a662f4f"); a company only exists underneath
// it (`/v3/a/{accountId}/companies/{companyId}.json`). An earlier version of
// this integration treated the pasted id as a company id everywhere, which
// 404d the one company flow that is documented to work and, when an owner
// pasted the account id instead (the only value that passed), fetched every
// call in the account under one company's practice.
//
// CallRail has no singleton key-paste connect route of its own: the owner
// holds one API key per CallRail company, one company per practice, exactly
// like GoHighLevel multi-subaccount — every credential lives on an
// integration_accounts row (see callrail.service.js), never on the single
// `integrations` marker row this module's siblings use. This file's only job
// is to resolve a pasted API key + CallRail account id + company id against
// CallRail's own endpoints BEFORE anything is ever persisted, so a bad key
// or a mismatched id is rejected at connect time with a clear message
// instead of stored and failing silently every night.
//
// NOT registered with provider-interface.js's registerProvider(): this isn't
// an IntegrationProvider (no authorize/callback/refresh/webhook/sync) — it is
// a plain verification helper, the same shape as emergent-sync.js's
// verifyCredentials for a provider with its own dedicated service+routes.
//
// SECURITY: every thrown message is shown to the owner verbatim by the panel
// and must never contain the raw key, in any branch.
// ============================================================================

const API_BASE = 'https://api.callrail.com/v3';

function headersFor(apiKey) {
    return { Authorization: `Token token="${apiKey}"`, Accept: 'application/json' };
}

async function safeFetch(url, apiKey) {
    try {
        return await fetch(url, { headers: headersFor(apiKey) });
    } catch {
        // Network-level failure (DNS, timeout, connection reset, ...). Never
        // surface the caught error's own message here — it can carry request
        // internals — a fixed, generic message is the safe choice.
        throw new Error('Could not reach CallRail. Check your connection and try again.');
    }
}

// Resolve a CallRail API key + ACCOUNT id + COMPANY id against CallRail's own
// company endpoint — one call that proves, together, that the key is valid
// AND can see that specific company (a company-scoped key that cannot see
// the account at all fails here exactly as a wrong account id would).
// Returns the company's own `name` on success; throws an Error with a
// message safe to show the owner on any failure (network error, bad key,
// unknown account/company, or an empty/malformed response).
export async function verify(apiKey, callrailAccountId, callrailCompanyId) {
    const key = apiKey == null ? '' : String(apiKey).trim();
    const accountId = callrailAccountId == null ? '' : String(callrailAccountId).trim();
    const companyId = callrailCompanyId == null ? '' : String(callrailCompanyId).trim();
    if (!key) throw new Error('A CallRail API key is required');
    if (!accountId) throw new Error('A CallRail account ID is required');
    if (!companyId) throw new Error('A CallRail company ID is required');

    const url = `${API_BASE}/a/${encodeURIComponent(accountId)}/companies/${encodeURIComponent(companyId)}.json`;
    const res = await safeFetch(url, key);

    if (res.status === 401 || res.status === 403) {
        throw new Error(`CallRail rejected this API key for account ${accountId}. Check the key and account ID and try again.`);
    }
    if (res.status === 404) {
        throw new Error(`CallRail company ${companyId} was not found under account ${accountId}. Check the company ID and try again.`);
    }
    if (!res.ok) {
        throw new Error(`CallRail could not verify this company right now (HTTP ${res.status}). Try again shortly.`);
    }

    const json = await res.json().catch(() => ({}));
    const name = json?.name;
    if (!name || typeof name !== 'string') {
        throw new Error(`CallRail did not return a company name for ${companyId}. Check the company ID and try again.`);
    }
    return name;
}

// List every company under a CallRail ACCOUNT — what the Add-company form
// uses to let the owner PICK a company from a list rather than type an
// opaque id, removing the whole class of paste-the-wrong-id error this
// integration shipped with. Same auth-failure handling as verify(); never
// leaks the key.
export async function listCompanies(apiKey, callrailAccountId) {
    const key = apiKey == null ? '' : String(apiKey).trim();
    const accountId = callrailAccountId == null ? '' : String(callrailAccountId).trim();
    if (!key) throw new Error('A CallRail API key is required');
    if (!accountId) throw new Error('A CallRail account ID is required');

    const url = `${API_BASE}/a/${encodeURIComponent(accountId)}/companies.json`;
    const res = await safeFetch(url, key);

    if (res.status === 401 || res.status === 403) {
        throw new Error(`CallRail rejected this API key for account ${accountId}. Check the key and account ID and try again.`);
    }
    if (res.status === 404) {
        throw new Error(`CallRail account ${accountId} was not found. Check the account ID and try again.`);
    }
    if (!res.ok) {
        throw new Error(`CallRail could not list companies right now (HTTP ${res.status}). Try again shortly.`);
    }

    const json = await res.json().catch(() => null);
    // The docs' companies.json response is a bare array; tolerate a
    // { companies: [...] } wrapper too rather than assume one shape.
    const list = Array.isArray(json) ? json : (Array.isArray(json?.companies) ? json.companies : null);
    if (!list) {
        throw new Error(`CallRail did not return a company list for account ${accountId}. Try again shortly.`);
    }
    return list
        .filter((c) => c && c.id != null)
        .map((c) => ({ id: String(c.id), name: typeof c.name === 'string' && c.name ? c.name : String(c.id) }));
}

export const callrailProvider = { verify, listCompanies };
