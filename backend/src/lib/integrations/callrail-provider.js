// ============================================================================
// CallRail provider — key + company verification, plus the KEY-ONLY discovery
// the Add-company flow uses to let an owner PICK an account and its companies
// instead of typing either id.
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
// KEY-ONLY DISCOVERY (this file's newest job): `GET /v3/a.json` returns
// EVERY account a given API key can see — settled by hitting the live
// endpoint with a real multi-account key, not assumed from the docs. An
// owner holding one key across several CallRail accounts (an agency-style
// key) previously had no way to use this integration at all: the old
// Add-company form demanded an account id they did not have. listAccounts
// (below) removes that requirement entirely — the owner pastes ONE key, this
// file resolves everything it can reach.
//
// CallRail has no singleton key-paste connect route of its own: the owner
// holds one API key per CallRail company, one company per practice, exactly
// like GoHighLevel multi-subaccount — every credential lives on an
// integration_accounts row (see callrail.service.js), never on the single
// `integrations` marker row this module's siblings use. This file's only job
// is to resolve a pasted API key (+ account id + company id, once picked)
// against CallRail's own endpoints BEFORE anything is ever persisted, so a
// bad key or a mismatched id is rejected at connect time with a clear
// message instead of stored and failing silently every night.
//
// NOT registered with provider-interface.js's registerProvider(): this isn't
// an IntegrationProvider (no authorize/callback/refresh/webhook/sync) — it is
// a plain verification/discovery helper, the same shape as emergent-sync.js's
// verifyCredentials for a provider with its own dedicated service+routes.
//
// SECURITY: every thrown message is shown to the owner verbatim by the panel
// and must never contain the raw key, in any branch.
// ============================================================================

const API_BASE = 'https://api.callrail.com/v3';
// CallRail's own example response for /v3/a.json shows per_page: 100 — used
// as the page size for BOTH discovery endpoints below (accounts, companies)
// so a request count is predictable and testable.
const DISCOVERY_PAGE_SIZE = 100;
// Safety cap on pages fetched per discovery call. Never hit at the owner's
// known real-world scale (one key, four accounts, a handful of companies
// each) — but without a cap, a misbehaving/looping response would fetch
// forever. Mirrors callrail-sync.js's own MAX_PAGES guard for calls.json.
const MAX_DISCOVERY_PAGES = 50;

const RETRY_BASE_MS = Number(process.env.CALLRAIL_RETRY_BASE_MS ?? 1000);
const MAX_RETRIES = 3;

function headersFor(apiKey) {
    return { Authorization: `Token token="${apiKey}"`, Accept: 'application/json' };
}

// Fetch with 429 backoff, honouring Retry-After when CallRail sends one.
// CallRail's documented rate limits (1,000/hour, 10,000/day) signal as HTTP
// 429 — NOT 403 (that is Dentally's scheme; do not copy that connector's
// handling here — see the vendor-facts doc). SHARED across every CallRail
// GET this integration makes: this file's verify/listAccounts/listCompanies
// (via safeFetch, below) AND callrail-sync.js's calls.json pull
// (fetchCallsPage), which used to carry its own separate copy of exactly
// this loop — this is the one retry implementation now, not two.
//
// Network-level failures (DNS, timeout, connection reset, ...) are NOT
// retried here — they throw immediately with a fixed, safe message. Never
// surface the caught error's own message — it can carry request internals —
// a fixed, generic message is the safe choice.
export async function fetchWithBackoff(url, headers) {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        let res;
        try {
            res = await fetch(url, { headers });
        } catch {
            throw new Error('Could not reach CallRail. Check your connection and try again.');
        }
        if (res.status === 429) {
            if (attempt < MAX_RETRIES) {
                const retryAfter = Number(res.headers?.get?.('retry-after'));
                const wait = Number.isFinite(retryAfter) && retryAfter > 0
                    ? retryAfter * 1000
                    : RETRY_BASE_MS * 2 ** attempt;
                await new Promise((resolve) => { setTimeout(resolve, wait); });
                continue;
            }
            // Still rate-limited after every retry — a specific, actionable
            // message rather than falling through to a generic "HTTP 429"
            // (which the original inline version of this loop did, via a
            // trailing throw that could never actually run — every loop
            // iteration either retried, returned, or threw before reaching
            // it. Fixed here since this is now the ONE shared implementation.)
            throw new Error('CallRail request failed: exhausted 429 retries');
        }
        return res;
    }
    /* c8 ignore next -- unreachable: every iteration above returns or throws */
    throw new Error('CallRail request failed: exhausted 429 retries');
}

async function safeFetch(url, apiKey) {
    return fetchWithBackoff(url, headersFor(apiKey));
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

// Pages a CallRail v3 "list" endpoint — /a.json (accounts) and
// /a/{accountId}/companies.json (companies) both shape their response as
// { page, per_page, total_pages, total_records, <arrayKey>: [...] }
// (companies.json is also known to sometimes answer with a bare array — see
// listCompanies's own comment, carried over from before this paginated).
//
// TERMINATION: an EMPTY page, never a short one. total_pages/total_records
// are metadata this deliberately does not treat as the sole stop signal —
// the same discipline already established elsewhere in this codebase for a
// paged read: "page on a unique key, stop on an empty page, not a short
// one" (the PostgREST 1000-row-cap trap). Concretely: this always requests
// page N+1 and only stops once THAT page comes back with zero rows.
//
// `pageUrl(page)` builds the URL for a given 1-based page number.
// `onBadStatus(status)` must THROW the caller's own key-safe message for a
// non-2xx response — different endpoints need different wording (e.g. "the
// account was not found" only makes sense for companies.json).
async function fetchAllPages(pageUrl, apiKey, arrayKey, onBadStatus) {
    const items = [];
    let page = 1;
    let requests = 0;
    for (;;) {
        const res = await safeFetch(pageUrl(page), apiKey);
        requests += 1;
        if (!res.ok) onBadStatus(res.status); // always throws — never returns

        const json = await res.json().catch(() => null);
        const list = Array.isArray(json) ? json : (Array.isArray(json?.[arrayKey]) ? json[arrayKey] : null);
        if (list === null) {
            throw new Error(`CallRail did not return a usable list of ${arrayKey}. Try again shortly.`);
        }
        if (list.length === 0) break;

        items.push(...list);
        if (requests >= MAX_DISCOVERY_PAGES) {
            console.warn(`[callrail] hit the ${MAX_DISCOVERY_PAGES}-page discovery cap on ${arrayKey} — more may exist`);
            break;
        }
        page += 1;
    }
    return items;
}

// List EVERY CallRail account a given API key can see — GET /v3/a.json. This
// is the fix for "the owner does not have an account id to hand" and for a
// key that spans several accounts (an agency-style key): the OLD Add-company
// flow demanded an account id be typed first, which blocked both cases
// completely. Never persists anything — a pure passthrough discovery call,
// same failure-message discipline as verify() (never leaks the key). Each
// thrown Error carries `.callrailStatus` (the real HTTP status CallRail
// answered, when known) so a caller can distinguish "this key is bad" (401/
// 403 — the owner's mistake) from "CallRail itself is having trouble" (5xx)
// without re-parsing the message text.
export async function listAccounts(apiKey) {
    const key = apiKey == null ? '' : String(apiKey).trim();
    if (!key) throw new Error('A CallRail API key is required');

    const items = await fetchAllPages(
        (page) => {
            const url = new URL(`${API_BASE}/a.json`);
            url.searchParams.set('page', String(page));
            url.searchParams.set('per_page', String(DISCOVERY_PAGE_SIZE));
            return url;
        },
        key,
        'accounts',
        (status) => {
            const err = new Error(status === 401 || status === 403
                ? 'CallRail rejected this API key. Check the key and try again.'
                : `CallRail could not list accounts right now (HTTP ${status}). Try again shortly.`);
            err.callrailStatus = status;
            throw err;
        },
    );
    return items
        .filter((a) => a && a.id != null)
        .map((a) => ({ id: String(a.id), name: typeof a.name === 'string' && a.name ? a.name : String(a.id) }));
}

// List every company under a CallRail ACCOUNT — used both by the standalone
// verify-style lookup and by the discovery fan-out in callrail.service.js's
// discoverAccounts, one call per account listAccounts returned. Same
// auth-failure handling as verify()/listAccounts (never leaks the key);
// `.callrailStatus` is stamped on the thrown Error for the same reason.
export async function listCompanies(apiKey, callrailAccountId) {
    const key = apiKey == null ? '' : String(apiKey).trim();
    const accountId = callrailAccountId == null ? '' : String(callrailAccountId).trim();
    if (!key) throw new Error('A CallRail API key is required');
    if (!accountId) throw new Error('A CallRail account ID is required');

    const items = await fetchAllPages(
        (page) => {
            const url = new URL(`${API_BASE}/a/${encodeURIComponent(accountId)}/companies.json`);
            url.searchParams.set('page', String(page));
            url.searchParams.set('per_page', String(DISCOVERY_PAGE_SIZE));
            return url;
        },
        key,
        'companies',
        (status) => {
            let err;
            if (status === 401 || status === 403) {
                err = new Error(`CallRail rejected this API key for account ${accountId}. Check the key and account ID and try again.`);
            } else if (status === 404) {
                err = new Error(`CallRail account ${accountId} was not found. Check the account ID and try again.`);
            } else {
                err = new Error(`CallRail could not list companies right now (HTTP ${status}). Try again shortly.`);
            }
            err.callrailStatus = status;
            throw err;
        },
    );
    return items
        .filter((c) => c && c.id != null)
        .map((c) => ({ id: String(c.id), name: typeof c.name === 'string' && c.name ? c.name : String(c.id) }));
}

export const callrailProvider = { verify, listAccounts, listCompanies };
