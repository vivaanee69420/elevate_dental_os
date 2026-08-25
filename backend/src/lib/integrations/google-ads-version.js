// backend/src/lib/integrations/google-ads-version.js
// ============================================================================
// Google Ads API version resolver — shared by the OAuth provider (account
// lookup) and the spend sync (searchStream).
//
// Google retires Ads API versions roughly yearly and a retired version 404s
// EVERY call. That has broken prod twice (v17, then v21 on 2026-08-10: connect
// failed with "listAccessibleCustomers HTTP 404" and the nightly spend sync
// went `failed` for 16 days). So besides a currently-served default, this
// module self-heals at runtime:
//
//   fetchWithApiVersion(urlFor, init)
//     1. call urlFor(currentVersion)
//     2. on HTTP 404 — the signature of a retired version — probe v+1..v+N
//        WITHOUT credentials (401/403 = served, 404 = retired), remember the
//        first live one, and retry the real call once on it
//     3. no live version → throw an actionable error naming
//        GOOGLE_ADS_API_VERSION
//
// Sunset schedule: developers.google.com/google-ads/api/docs/sunset-dates
// (v22 → Oct 2026, v23 → Feb 2027, v24 → May 2027, v25 → Aug 2027).
// ============================================================================

export const DEFAULT_API_VERSION = 'v25';
/** How many versions ahead of the retired one to probe. */
export const PROBE_AHEAD = 8;

let resolved = null; // version proven live at runtime (process-wide)

export function apiBase() {
    return process.env.GOOGLE_ADS_API_BASE || 'https://googleads.googleapis.com';
}

/** Version from env (trimmed) or the default. */
export function configuredApiVersion() {
    return (process.env.GOOGLE_ADS_API_VERSION || DEFAULT_API_VERSION).trim() || DEFAULT_API_VERSION;
}

/** Version to call right now: the runtime-proven one if we had to advance, else configured. */
export function currentApiVersion() {
    return resolved || configuredApiVersion();
}

export function resetApiVersionCache() {
    resolved = null;
}

function versionNumber(v) {
    const n = Number(String(v).replace(/^v/i, ''));
    return Number.isFinite(n) ? n : NaN;
}

/**
 * Find the first version newer than `from` that Google still serves. Probes
 * customers:listAccessibleCustomers with NO credentials: a served version
 * answers 401/403, a retired one 404. Remembers the winner.
 */
export async function advanceApiVersion(from) {
    const start = versionNumber(from);
    if (Number.isNaN(start)) throw new Error(`Google Ads API version "${from}" is not of the form vNN`);
    for (let n = start + 1; n <= start + PROBE_AHEAD; n++) {
        const candidate = `v${n}`;
        let status;
        try {
            const res = await fetch(`${apiBase()}/${candidate}/customers:listAccessibleCustomers`, { method: 'GET' });
            status = res.status;
        } catch {
            continue; // network blip on a probe — try the next one
        }
        if (status !== 404) {
            resolved = candidate;
            return candidate;
        }
    }
    throw new Error(
        `Google Ads API ${from} has been retired by Google (HTTP 404) and none of v${start + 1}–v${start + PROBE_AHEAD} responded. `
        + 'Set GOOGLE_ADS_API_VERSION to a currently-supported version '
        + '(https://developers.google.com/google-ads/api/docs/sunset-dates) and redeploy.',
    );
}

/**
 * fetch() against a versioned Google Ads URL, advancing past a retired
 * version once. `urlFor(version)` builds the URL; `init` is passed to fetch.
 */
export async function fetchWithApiVersion(urlFor, init) {
    const first = currentApiVersion();
    const res = await fetch(urlFor(first), init);
    if (res.status !== 404) return res;
    const next = await advanceApiVersion(first);
    return fetch(urlFor(next), init);
}
