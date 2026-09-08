// Dentally sync — polls the Dentally v1 REST API per active org integration and
// upserts patients/appointments/payments into our tables with source='dentally'.
//
// Webhooks are unreliable for some Dentally events, so this 30-min poller closes
// the gap (Stripe/Xero use webhooks; Dentally + SOE use this).
//
// Idempotent: upserts on (organisation_id, source, external_id) — re-polling the
// same window updates rows in place, never duplicates (migration 20260101000014).
//
//   GET /v1/patients?updated_after=<ISO>      -> contacts   (pms_external_id)
//   GET /v1/appointments?updated_after=<ISO>  -> appointments (pms_external_id)
//   GET /v1/payments?dated_after=<DATE>       -> payments    (external_id; /payments has no updated_after)
//
// Per Dentally docs (elevate-complete/04-integrations/DENTALLY_SETUP.md):
//   - Authorization: Bearer <apiKey>  (decrypted from integrations.secrets)
//   - User-Agent header is MANDATORY (requests without it are rejected)
//   - Rate limit ~10 req/s; back off on 429 Retry-After
//   - Pagination: page + per_page=100, meta.total_pages, response wrapped in a key
//   - A date filter is mandatory (we always pass updated_after)
//
// NOTE: remote field names below follow the documented v1 shapes; verify against
// the sandbox (https://api.sandbox.dentally.co) during UAT and adjust the map*()
// helpers if a field differs. The fetch/paginate/resolve/upsert structure is stable.

import { integrationRepository } from "../../repositories/integration.repository.js";
import { markBootstrapStarted, markBootstrapFinished } from './bootstrap-recovery.js';
import { decryptSecret } from "../crypto.js";
import { parseOpeningHours } from "../dentally-opening-hours.js";
import { practiceOpeningHoursRepository } from "../../repositories/practice-opening-hours.repository.js";
import * as supabase_1 from "../supabase.js";

const DEFAULT_BASE = 'https://api.dentally.co/v1';
const USER_AGENT = 'ElevateOS/1.0 (integrations@elevate.app)';
const PER_PAGE = 100;
const RATE_DELAY_MS = 120;   // ~8 req/s, under Dentally's ~10/s cap
const UPSERT_CHUNK = 500;
const REQUEST_TIMEOUT_MS = 30000; // abort a hung Dentally request, never hang forever
const MAX_PAGES = 100;       // cap a single sync to 100 pages/resource (~10k rows) so a foreground Refresh stays bounded; the incremental cursor catches the rest next run
const WINDOW_RECON_MAX_PAGES = 400; // window-scoped reconciliation (~40k rows). Deliberately NOT MAX_PAGES: Dentally ignores `before` on /appointments, so a +/-35-day window pull actually returns everything from `after` onward INCLUDING the whole future diary — measured at 17,505 rows (176 pages) for this org, which silently blew the 100-page MAX_PAGES and made the delete prune abort with 'page_cap' every single night.
const INVOICE_RECON_MAX_PAGES = 1000; // invoice delete-reconciliation pages the WHOLE collection (Dentally ignores date filters on /invoices) — ~240 pages at 23.7k invoices today, so this is a runaway guard with room to grow, not a target. Hitting it ABORTS the prune rather than acting on a partial remote set.
const BACKFILL_MAX_PAGES = 15000; // full backfill ceiling (~1.5M rows/resource) — one-off, pulls the 6-month window. MUST exceed the largest collection: /treatment_plan_items returns ~725k rows (7.2k pages) and Dentally IGNORES the completed/date filters, so the whole collection must be paged to find the completed subset. The old 5000-page (500k-row) cap truncated the oldest ~225k items, silently dropping completed treatments scattered across past months (the "Treatments Completed undercount" bug). The page loop self-terminates at the real end (items.length < PER_PAGE), so this is only a runaway guard, not a target.
const BACKFILL_MONTHS = 6;       // nightly full-backfill cap: most-recent 6 months of history, no deeper (product rule — the nightly cron stays light; on-connect already landed the full year)
// Rolling 6-month updated_after for full pulls. Dentally requires the param; we
// deliberately cap the nightly backfill at 6 months (rather than 2 years or
// all-time, which was a 2005 anchor) so a nightly pull stays bounded on
// long-lived practices.
function backfillSince() {
    return new Date(Date.now() - BACKFILL_MONTHS * 30 * 86400000).toISOString();
}
const RECENT_MONTHS = 12;        // on-connect bootstrap (first fill) window: last 12 months — a connect that lands a full year (dashboards are TTM); the nightly cron then maintains the trailing 6 months (see syncAllOrgs)
const BOOTSTRAP_MAX_PAGES = 900; // ~90k rows/resource cap for the on-connect pull — headroom for a busy multi-site group's full 1-year history so the pull reaches recent + upcoming, not just the oldest rows
// On the FIRST pull we only want live work — upcoming, not-yet-closed
// appointments — so onboarding is fast and the Operations view is immediately
// useful. These states are "closed" and dropped from the open pull; the
// full-history button + nightly cron backfill them later.
const CLOSED_APPT_STATES = new Set(['cancelled', 'completed', 'no_show']);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// fetch with an abort-based timeout so one stuck request can't block a sync
// (and, on connect, the connect response) indefinitely.
async function fetchWithTimeout(url, opts) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
    try {
        return await fetch(url, { ...opts, signal: ac.signal });
    } catch (err) {
        // AbortController throws a generic DOMException whose message is
        // "This operation was aborted" — opaque when it lands in
        // integrations.last_error and shows on the Connect card. Translate our
        // own timeout into an actionable message; re-throw real network errors
        // (DNS, ECONNREFUSED, TLS) untouched so callers can retry/surface them.
        if (err?.name === 'AbortError') {
            throw new Error(`Dentally request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
        }
        throw err;
    } finally {
        clearTimeout(timer);
    }
}

// True when a Dentally response is a rate-limit signal. Dentally uses BOTH a
// standard 429 AND a 403 whose body is { error: { type: 'invalid_access_error',
// message: 'Rate limit exceeded' } } (its sustained cap, sent with no Retry-After
// header). Reads the body off a CLONE so the caller can still consume res. A 403
// with any other body is a genuine auth/permission failure, not a rate-limit.
async function isRateLimited(res) {
    if (res.status === 429) return true;
    if (res.status !== 403) return false;
    try {
        const text = await res.clone().text();
        return /rate limit/i.test(text);
    } catch {
        return false;
    }
}

// One page fetch for the reconcilers, with Dentally's TWO rate-limit signals
// handled. The reconcilers page long collections (the invoice pass alone is
// ~240 pages), which is exactly the workload that trips Dentally's sustained cap
// — and that cap arrives as a 403 with a "Rate limit exceeded" body, NOT a 429.
// Treating it as a hard failure would abort the reconcile every night for the
// biggest orgs, which are the ones with the most to reconcile. Bounded attempts,
// so a genuine 403/permission error still fails fast instead of spinning.
async function fetchReconcilePage(url, auth, maxAttempts = 6) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        let res;
        try {
            res = await fetchWithTimeout(url, { headers: { Authorization: auth, 'User-Agent': USER_AGENT, Accept: 'application/json' } });
        } catch {
            return { res: null, aborted: 'fetch_error' };
        }
        if (await isRateLimited(res)) {
            const ra = Number(res.headers?.get?.('retry-after'));
            await sleep(ra ? ra * 1000 : Math.min(60000, 2000 * 2 ** attempt));
            continue;
        }
        if (!res.ok) return { res: null, aborted: `http_${res.status}` };
        return { res, aborted: null };
    }
    return { res: null, aborted: 'rate_limited' };
}

// Refresh ~5 min before the OAuth token's stated expiry to avoid mid-call 401s.
function tokenStale(expiresAt) {
    if (!expiresAt) return false;
    return Date.now() >= new Date(expiresAt).getTime() - 5 * 60 * 1000;
}

// Resolve the Authorization header for a Dentally integration row.
//   apiKey path -> Bearer <apiKey> (long-lived, never refreshed)
//   OAuth path  -> Bearer <access_token>, refreshing first if near expiry
export async function resolveDentallyAuth(orgId, integration) {
    let parsed;
    try { parsed = JSON.parse(decryptSecret(integration.secrets)); } catch { return null; }
    if (parsed.apiKey) return `Bearer ${parsed.apiKey}`;
    if (!parsed.access_token) return null;
    if (tokenStale(integration.expires_at)) {
        try {
            const { DentallyProvider } = await import('./dentally-provider.js');
            await DentallyProvider.refresh(orgId);
            const fresh = await integrationRepository.getByProvider(orgId, 'dentally');
            if (fresh?.secrets) parsed = JSON.parse(decryptSecret(fresh.secrets));
        } catch { /* refresh failed — proceed with the existing token; a downstream 401 surfaces it */ }
    }
    return parsed.access_token ? `Bearer ${parsed.access_token}` : null;
}

// One-shot 401 guard for long backfill pagers. On a 401, refresh the OAuth
// token once, re-resolve the bearer, and retry. Returns { res, auth } so the
// caller adopts the (possibly refreshed) bearer for subsequent pages. A second
// 401 (e.g. a genuinely revoked token) is returned as-is for the caller to surface.
export async function dentallyFetchWithRefresh(orgId, auth, url, extraHeaders = {}) {
    const headers = { Authorization: auth, 'User-Agent': USER_AGENT, Accept: 'application/json', ...extraHeaders };
    let res = await fetchWithTimeout(url, { headers });
    if (res.status === 401) {
        try {
            const { DentallyProvider } = await import('./dentally-provider.js');
            await DentallyProvider.refresh(orgId);
            const fresh = await integrationRepository.getByProvider(orgId, 'dentally');
            const newAuth = fresh ? await resolveDentallyAuth(orgId, fresh) : auth;
            if (newAuth && newAuth !== auth) {
                auth = newAuth;
                res = await fetchWithTimeout(url, { headers: { ...headers, Authorization: auth } });
            }
        } catch { /* refresh failed — return the original 401 for the caller to surface */ }
    }
    return { res, auth };
}

// Page through a Dentally collection endpoint, handing each page to `onBatch`
// as it arrives (then discarding it) instead of buffering the whole resource.
// Peak memory is one page (~PER_PAGE rows): a full backfill of a large group
// otherwise accumulated hundreds of thousands of rows in a single array and
// OOM-killed the (fire-and-forget) sync process mid-pull — a SIGKILL bypasses
// the catch, so the in-memory progress froze and the bar stranded at its last
// value. Honours 429 Retry-After and the mandatory User-Agent + date filter.
// Returns the total record count fetched. onBatch(items, page) is awaited so the
// upsert's back-pressure paces the fetch; onPage(page, totalPages, fetchedSoFar)
// drives the progress bar.
async function streamPagesOnce(orgId, base, path, auth, params, onBatch, onPage = null, maxPages = MAX_PAGES) {
    let page = 1;
    let fetched = 0;
    for (;;) {
        const url = new URL(`${base}${path}`);
        for (const [k, v] of Object.entries({ ...params, page, per_page: PER_PAGE })) {
            url.searchParams.set(k, String(v));
        }
        let res = null;
        let lastErr = null;
        for (let attempt = 0; attempt < 7; attempt++) {
            try {
                ({ res, auth } = await dentallyFetchWithRefresh(orgId, auth, url));
            } catch (err) {
                // A timeout or transient network blip on ONE page used to throw
                // straight out and fail the whole sync (the "This operation was
                // aborted" failures). Retry with linear backoff before giving up
                // so a single slow page can't abandon a multi-thousand-row pull.
                lastErr = err;
                res = null;
                if (attempt < 3) { await sleep(1000 * (attempt + 1)); continue; }
                throw err;
            }
            // Dentally signals RATE LIMITING two ways: a standard 429, AND a 403 with
            // body { error: { type: 'invalid_access_error', message: 'Rate limit
            // exceeded' } } and NO Retry-After header (its sustained/hourly cap). The
            // old code only knew 429, so a 403 rate-limit fell straight through to the
            // `!res.ok` throw below and aborted the phase — which is why the LAST phase
            // each sync (treatment_items) silently 403-failed once the earlier phases
            // had burned the request budget. Treat both as retryable with backoff; only
            // a non-rate-limit 403 (real auth/permission) fails fast.
            if (await isRateLimited(res)) {
                const retryAfter = Number(res.headers.get('retry-after'));
                await sleep(retryAfter ? retryAfter * 1000 : Math.min(60000, 2000 * 2 ** attempt));
                continue;
            }
            break;
        }
        if (!res) throw lastErr ?? new Error(`Dentally ${path}: no response`);
        if (!res.ok) throw new Error(`Dentally ${path} -> HTTP ${res.status}`);
        const body = await res.json();
        // Dentally wraps the collection in a key (e.g. { patients: [...], meta }).
        const key = Object.keys(body).find((k) => Array.isArray(body[k]));
        const items = key ? body[key] : [];
        fetched += items.length;
        // Flush this page before fetching the next — never hold more than one
        // page of rows in memory.
        if (items.length && onBatch) await onBatch(items, page);
        const totalPages = body.meta?.total_pages;
        // fetched = records pulled so far this phase, so the UI can show
        // "1,247 records pulled" live (Dentally often omits total_pages, so a
        // running count is the clearest signal of what's happening).
        if (onPage) onPage(page, totalPages ? Math.min(totalPages, maxPages) : null, fetched);
        const done = totalPages ? page >= totalPages : items.length < PER_PAGE;
        if (done) break;
        if (page >= maxPages) { // bound a single run; cursor resumes next sync
            console.warn(`[dentally] ${path}: hit ${maxPages}-page cap (${fetched} rows), stopping this run`);
            break;
        }
        page++;
        await sleep(RATE_DELAY_MS);
    }
    return fetched;
}

// Expand a pull into one request pass per selected site.
//
// A Dentally grant covers the whole GROUP and its `site_id` filter takes ONE
// value, so a two-practice selection is two filtered pulls — never one
// unfiltered pull that downloads the group and throws most of it away.
// Measured on the live token: patients 9,553 -> 4,108, appointments 33,828 ->
// 12,675, payments 13,138 -> 5,103, invoices 23,721 -> 9,294, practitioners
// 218 -> 75, users 270 -> 99.
//
// Doing it HERE rather than in each pull means every collection inherits it and
// no call site has to remember. `__sites` is stripped before the URL is built,
// so it can never leak into a query string.
export function sitePasses(params) {
    const rest = { ...(params || {}) };
    const sites = rest.__sites;
    delete rest.__sites;
    // No selection means every site — the behaviour of every organisation
    // connected before the picker existed. One pass, unfiltered, unchanged.
    if (!Array.isArray(sites) || sites.length === 0) return [rest];
    // De-duplicated: the same site twice would pull and upsert it twice.
    return [...new Set(sites.map(String))].map((site_id) => ({ ...rest, site_id }));
}

async function streamPages(orgId, base, path, auth, params, onBatch, onPage = null, maxPages = MAX_PAGES) {
    const passes = sitePasses(params);
    let basePage = 0;
    let baseCount = 0;
    let fetched = 0;
    for (const pass of passes) {
        let lastPage = 0;
        let lastCount = 0;
        // Counters accumulate ACROSS passes so the phase advances once instead
        // of restarting per practice. totalPages is only meaningful for a
        // single pass — with several, the true total is unknown until the last
        // one reports, so send null and let reportPct grow the estimate from
        // the live pull (its documented fallback) rather than render a
        // percentage that jumps backwards.
        const report = onPage
            ? (page, totalPages, count) => {
                lastPage = page;
                lastCount = count ?? 0;
                onPage(basePage + page, passes.length > 1 ? null : totalPages, baseCount + lastCount);
            }
            : null;
        fetched += await streamPagesOnce(orgId, base, path, auth, pass, onBatch, report, maxPages);
        basePage += lastPage;
        baseCount += lastCount;
    }
    return fetched;
}

// Collect every page into a flat array. Thin wrapper over streamPages for the
// small, unweighted resources (practitioners, users) where buffering the whole
// set is cheap. The heavy resources stream-upsert per page instead (see pulls).
async function fetchAllPages(orgId, base, path, auth, params, onPage = null, maxPages = MAX_PAGES) {
    const out = [];
    await streamPages(orgId, base, path, auth, params, (items) => { out.push(...items); }, onPage, maxPages);
    return out;
}

// Fetch a single page (for cheap site-id discovery — not a full paginate).
async function fetchOnePage(base, path, auth, params) {
    const url = new URL(`${base}${path}`);
    for (const [k, v] of Object.entries({ ...params, page: 1, per_page: PER_PAGE })) {
        url.searchParams.set(k, String(v));
    }
    const res = await fetchWithTimeout(url, {
        headers: { Authorization: auth, 'User-Agent': USER_AGENT, Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`Dentally ${path} -> HTTP ${res.status}`);
    const body = await res.json();
    const key = Object.keys(body).find((k) => Array.isArray(body[k]));
    return key ? body[key] : [];
}

// Cheap page-count probe used to size the progress bar BEFORE pulling: one
// page-1 request per resource yields meta.total_pages. MUST use the same
// per_page as the real pull (total_pages = ceil(total / per_page), so a
// different per_page would give a mismatched count). Bounded by maxPages so the
// estimate matches what the pull will actually fetch. Returns 0 on any error so
// a single failing resource can't break the overall weighting.
// Overall progress %, weighted by each resource's real page count. phaseTotals =
// [patientPages, apptPages, payPages] probed up front. idx = current phase,
// page = current 1-based page within it. Held at 99 until the caller marks the
// whole sync done, so the bar never shows a premature 100.
export function weightedPct(idx, page, phaseTotals) {
    const grandTotal = Math.max(1, phaseTotals.reduce((a, b) => a + b, 0));
    let done = 0;
    for (let i = 0; i < idx; i++) done += phaseTotals[i];   // fully-completed phases
    done += Math.min(page, phaseTotals[idx]);               // progress in this phase (0 if phase has no pages)
    return Math.min(99, Math.round((done / grandTotal) * 100));
}

// Update the live progress weighting for one reported page and return the pct.
// The up-front probe (fetchPageCount) UNDER-counts a phase when Dentally omits
// meta.total_pages (it falls back to 1 page) or when the probe times out (0).
// On the bootstrap pull that hits the patients phase, which pulls the 1-year
// patient window — the longest phase — so weighting it as ~1 page made
// weightedPct's Math.min(page, total) clamp the bar near 0% for the entire
// phase: it looked frozen even though the pull was running. Grow the phase's
// total from the live pull (the real total_pages when present, and never below
// the page we've actually reached) so the probe can't freeze the bar. Mutates
// phaseTotals in place; earlier phases keep their grown totals so completed
// phases still contribute their true page counts.
export function reportPct(phaseTotals, idx, page, totalPages) {
    phaseTotals[idx] = Math.max(phaseTotals[idx] || 0, totalPages || 0, page);
    return weightedPct(idx, page, phaseTotals);
}

// Size the progress bar for what the pull will ACTUALLY fetch. This probe must
// carry the same site filter as the pull, or a one-practice sub-account is
// weighted against the whole group's page count and its bar crawls to ~40% and
// stops. Several sites means several probes, summed — the same expansion the
// pull itself makes.
async function fetchPageCount(base, path, auth, params, maxPages = MAX_PAGES) {
    const passes = sitePasses(params);
    if (passes.length > 1) {
        const counts = await Promise.all(
            passes.map((pass) => fetchPageCountOnce(base, path, auth, pass, maxPages)),
        );
        return counts.reduce((a, b) => a + b, 0);
    }
    return fetchPageCountOnce(base, path, auth, passes[0], maxPages);
}

async function fetchPageCountOnce(base, path, auth, params, maxPages = MAX_PAGES) {
    try {
        const url = new URL(`${base}${path}`);
        for (const [k, v] of Object.entries({ ...params, page: 1, per_page: PER_PAGE })) {
            url.searchParams.set(k, String(v));
        }
        const res = await fetchWithTimeout(url, {
            headers: { Authorization: auth, 'User-Agent': USER_AGENT, Accept: 'application/json' },
        });
        if (!res.ok) return 0;
        const body = await res.json();
        const total = Number(body.meta?.total_pages);
        if (Number.isFinite(total) && total > 0) return Math.min(total, maxPages);
        // No total_pages in meta: at least one page if the first page has rows.
        const key = Object.keys(body).find((k) => Array.isArray(body[k]));
        return key && body[key].length ? 1 : 0;
    } catch {
        return 0;
    }
}

// Sample Dentally and report the distinct site_ids it returns (with counts), so
// the owner can map each practice without hunting in Dentally settings. Samples
// one page each of patients/appointments/payments over the last year.
export async function detectSiteIds(orgId, integration) {
    const base = integration.config?.base_url ?? DEFAULT_BASE;
    const auth = await resolveDentallyAuth(orgId, integration);
    if (!auth) return { error: 'no_auth', siteIds: [] };
    const since = new Date(Date.now() - 365 * 86400000).toISOString();
    const counts = new Map();
    const tally = (items) => {
        for (const it of items) {
            const s = it?.site_id;
            if (s != null) counts.set(String(s), (counts.get(String(s)) || 0) + 1);
        }
    };
    // Sample records for site ids + fetch the sites list for human names so the
    // owner sees "Ashford" not a raw UUID. /sites is the documented resource;
    // fall back to /practices if a tenant exposes it under that name.
    const [patients, appts, pays, sites, practices] = await Promise.all([
        fetchOnePage(base, '/patients', auth, { updated_after: since }).catch(() => []),
        fetchOnePage(base, '/appointments', auth, { updated_after: since }).catch(() => []),
        fetchOnePage(base, '/payments', auth, { dated_after: since.slice(0, 10) }).catch(() => []),
        fetchOnePage(base, '/sites', auth, {}).catch(() => []),
        fetchOnePage(base, '/practices', auth, {}).catch(() => []),
    ]);
    tally(patients); tally(appts); tally(pays);
    const nameById = new Map();
    for (const s of [...sites, ...practices]) {
        if (s?.id != null) nameById.set(String(s.id), s.name ?? s.title ?? s.label ?? null);
    }
    const siteIds = [...counts.entries()]
        .map(([site_id, count]) => ({ site_id, count, name: nameById.get(site_id) ?? null }))
        .sort((a, b) => b.count - a.count);
    return { siteIds };
}

// ---- field mappers (verify against sandbox) --------------------------------

function mapAppointmentStatus(s) {
    // Dentally's live /appointments `state` is a Title-Case, space-separated label
    // ("Did not attend", "In surgery", "Cancelled", "Completed"), NOT the snake/
    // lowercase tokens the old switch matched. Without normalising the spaces,
    // "Did not attend" lowercased to "did not attend" missed every case and fell
    // through to 'scheduled' — so no_show NEVER populated and DNA volume hid inside
    // the scheduled bucket. Collapse whitespace to underscores first; the snake/
    // token cases are retained for the webhook + test fakes that predate the live shape.
    switch (String(s || '').toLowerCase().trim().replace(/\s+/g, '_')) {
        case 'confirmed': return 'confirmed';
        case 'in_progress': case 'arrived': case 'in_surgery': return 'in_progress';
        case 'completed': case 'finished': return 'completed';
        case 'cancelled': case 'canceled': return 'cancelled';
        case 'did_not_attend': case 'dna': case 'fta': case 'failed_to_attend': return 'no_show';
        default: return 'scheduled'; // planned, pending, metadata_only, ...
    }
}

function mapPaymentStatus(p) {
    if (p?.paid === true) return 'settled';
    // Live Dentally /payments `status` vocabulary: paid | unexplained |
    // partially_explained (verified against the API). `state` kept for the
    // webhook/test fakes that predate the live shape.
    switch (String(p?.state || p?.status || '').toLowerCase()) {
        case 'paid': case 'settled': return 'settled';
        // unexplained / partially_explained = money RECEIVED, not yet allocated to
        // an invoice line (a patient credit / deposit sitting on the account). It is
        // cash in, so it is a settled RECEIPT — not pending debt. `amount` is the
        // full sum taken; `amount_unexplained` is only the unallocated remainder.
        // (Mapping these to pending dropped real receipts out of the RECEIVED card
        // and inflated a fake all-time OUTSTANDING — see dentally-payment-status-misclass.)
        case 'unexplained': case 'partially_explained': return 'settled';
        case 'failed': case 'declined': return 'failed';
        case 'refunded': case 'reversed': return 'refunded';
        // Truly unknown states stay pending (conservative: not counted as received).
        default: return 'pending';
    }
}

// Dentally sends `method` as a free-text Title-Case label ("Credit Card",
// "Debit Card", "Cash", "BACS", ...). The old lowercase-snake whitelist null'd
// every value that didn't match verbatim — ~94% of real rows. Normalise the
// known labels to our canonical set; for anything unrecognised keep a slug of
// the raw value rather than dropping the taxonomy. Only empty -> null.
// The values `payments.method` will actually accept — payments_method_check.
// This list is the CONTRACT, and mapPaymentMethod must never emit anything
// outside it: a rejected row is not a mislabelled payment, it is a payment that
// vanishes. upsertChunked retries the chunk row-by-row, logs "skipped N
// unstorable row(s)" and carries on, so the loss is silent and permanent.
// Measured live over 12 months before this was closed: 183 payments worth
// GBP 7,540.45 that could never be stored — 181 "Other", 1 "American Express"
// and 1 "Cheque", the last of which the canon table below already knew about
// while the constraint did not.
const PAYMENT_METHODS = new Set([
    'card', 'apple_pay', 'google_pay', 'bank_transfer', 'cash',
    'direct_debit', 'finance', 'card_on_file', 'pay_link', 'cheque',
    'amex', 'other',
]);

function mapPaymentMethod(m) {
    const v = String(m ?? '').trim().toLowerCase();
    // Nullable by design: "not stated" is a different fact from "stated as
    // something we do not recognise", and only the latter becomes 'other'.
    if (!v) return null;
    const canon = {
        'card': 'card', 'credit card': 'card', 'debit card': 'card',
        'card on file': 'card', 'card_on_file': 'card', 'stripe': 'card',
        'cash': 'cash',
        'cheque': 'cheque', 'check': 'cheque',
        'american express': 'amex', 'amex': 'amex',
        'bacs': 'bank_transfer', 'bank transfer': 'bank_transfer',
        'bank_transfer': 'bank_transfer', 'direct credit': 'bank_transfer',
        'direct debit': 'direct_debit', 'direct_debit': 'direct_debit',
        'finance': 'finance',
        'apple pay': 'apple_pay', 'apple_pay': 'apple_pay',
        'google pay': 'google_pay', 'google_pay': 'google_pay',
        'pay link': 'pay_link', 'pay_link': 'pay_link',
        'other': 'other',
    };
    const mapped = canon[v] ?? v.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    // Closed set. An unrecognised label is bucketed honestly as 'other' rather
    // than slugified into a value the database will refuse — the money matters
    // more than the label, and a payment we cannot describe is still a payment.
    return PAYMENT_METHODS.has(mapped) ? mapped : 'other';
}

function toPence(amount) {
    const n = Number(amount);
    return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

// ---- upsert helper ----------------------------------------------------------

async function upsertChunked(table, rows, onConflict) {
    let synced = 0;
    let failed = 0;
    for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
        const chunk = rows.slice(i, i + UPSERT_CHUNK);
        const { error } = await supabase_1.serviceClient.from(table).upsert(chunk, { onConflict });
        if (!error) { synced += chunk.length; continue; }
        // One bad row must not drop a 500-row chunk or abort the whole sync —
        // retry the chunk row-by-row, skipping only the offending rows.
        for (const row of chunk) {
            const { error: e2 } = await supabase_1.serviceClient.from(table).upsert([row], { onConflict });
            if (e2) failed++; else synced++;
        }
    }
    if (failed) console.warn(`[dentally] ${table}: skipped ${failed} unstorable row(s)`);
    return synced;
}

// Build { pms_site_id -> practices.id } for an org so site ids resolve to a practice.
async function loadSiteMap(orgId) {
    const { data } = await supabase_1.serviceClient
        .from('practices')
        .select('id, pms_site_id')
        .eq('organisation_id', orgId)
        .not('pms_site_id', 'is', null);
    const map = new Map();
    for (const p of data ?? []) map.set(String(p.pms_site_id), p.id);
    return map;
}

// Opening-hours-only sync — one unpaged request, so it can be run on demand
// (a "refresh hours" action, or right after the 000180 migration) without the
// heavy patients/appointments/invoice phases.
export async function syncOpeningHoursOnly(orgId, integration) {
    const base = integration.config?.base_url ?? DEFAULT_BASE;
    const auth = await resolveDentallyAuth(orgId, integration);
    if (!auth) return { error: 'no_auth' };
    const siteMap = await loadSiteMap(orgId);
    return pullOpeningHours(orgId, base, auth, siteMap);
}

// ---- practitioner rota ------------------------------------------------------

// How far the nightly pull reaches. BACKWARDS, because utilisation is reported
// over months that have already finished and a denominator covering only the
// future would be no denominator at all; forwards, because a part-finished
// month still needs one for the days already booked.
export const ROTA_BACK_DAYS = 45;
export const ROTA_FORWARD_DAYS = 60;
// The one-time reach for history, run once per org and then recorded. 400 days
// covers the twelve months the appointment pull already holds, plus slack.
export const ROTA_BACKFILL_DAYS = 400;
// The rota emits ONE ROW PER PRACTITIONER PER DAY whether they worked or not,
// so its volume is days x roster, not days x activity: a 460-day backfill for
// a 55-practitioner group is ~25,300 rows, or 253 pages, and an org with no
// mapped sites pulls all of that in one pass. The shared MAX_PAGES of 100
// would have stopped a third of the way through, logged a warning nobody
// reads, and RETURNED NORMALLY — the backfill would then have stamped itself
// complete over a partial history that no later run would ever go back for.
// (The same 100-page cap silently truncated the appointment reconciler; see
// WINDOW_RECON_MAX_PAGES.) 600 leaves room for a group twice this size.
export const ROTA_MAX_PAGES = 600;

/** `n` days from today as YYYY-MM-DD, at midday so a DST shift cannot move the date. */
export function rotaDay(n, now = new Date()) {
    const d = new Date(now);
    d.setUTCHours(12, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
}

/**
 * One Dentally rota row -> one practitioner_rota_days row.
 *
 * `unavailable: true` arrives with NULL times and is KEPT as a row, not
 * dropped: a rostered day off and no rota at all are different states, and
 * collapsing them would make an absent rota read as a day nobody worked.
 */
export function rotaRow(orgId, r, practiceId, siteId) {
    const pid = r?.practitioner_id;
    if (pid === null || pid === undefined || !r?.day) return null;
    const off = r.unavailable === true || !r.start_time || !r.end_time;
    let breakSecs = 0;
    if (!off) {
        for (const b of Array.isArray(r.breaks) ? r.breaks : []) {
            const from = Date.parse(b?.start_time);
            const to = Date.parse(b?.end_time);
            if (Number.isFinite(from) && Number.isFinite(to) && to > from) {
                breakSecs += Math.round((to - from) / 1000);
            }
        }
    }
    return {
        organisation_id: orgId,
        pms_practitioner_id: String(pid),
        day: r.day,
        practice_id: practiceId ?? null,
        pms_site_id: siteId ?? null,
        starts_at: off ? null : r.start_time,
        ends_at: off ? null : r.end_time,
        break_secs: breakSecs,
        unavailable: off,
        rota_external_id: r.id ? String(r.id) : null,
        synced_at: new Date().toISOString(),
    };
}

/**
 * The rota, from GET /rota_practitioner_diaries.
 *
 * `after` and `before` are REQUIRED. Without them the endpoint returns 400
 * with an empty body, which is what made it look absent through 29 candidate
 * paths and 48 parameter combinations.
 *
 * Fetched ONCE PER MAPPED SITE, because a rota row carries no site_id in its
 * body while site_id IS a query filter. That is only sound because the sites
 * partition the feed, which was measured rather than assumed: per-site counts
 * summed to 1,705 against an unfiltered 1,705, union 1,705, no orphans. An org
 * with no mapped sites falls back to ONE unfiltered pull and leaves
 * practice_id null, which reads as "group-wide" and never as a practice.
 *
 * `include_inactive_practitioners` is ON, and not to pull in more people: a
 * clinician who left mid-year is inactive today but still holds the rostered
 * days behind last spring's numbers, and without the flag those days vanish
 * from history (measured: 47 of 62 practitioners covered without it, 57 with).
 * The staff it adds who never treat a patient are excluded at REPORT time,
 * where the whole window is in hand, not here.
 */
/**
 * `meta.total` for a rota window, in one request. Returns null when Dentally
 * omits it — an absent total is unknown, and unknown must not be compared
 * against as if it were zero.
 */
async function fetchRotaTotal(orgId, base, auth, params) {
    const url = new URL(`${base}/rota_practitioner_diaries`);
    for (const [k, v] of Object.entries({ ...params, page: 1, per_page: 1 })) {
        url.searchParams.set(k, String(v));
    }
    const { res } = await dentallyFetchWithRefresh(orgId, auth, url);
    if (!res.ok) throw new Error(`Dentally /rota_practitioner_diaries -> HTTP ${res.status}`);
    const total = (await res.json())?.meta?.total;
    return Number.isFinite(total) ? total : null;
}

async function pullRota(orgId, base, auth, siteMap, { since, until } = {}) {
    const after = since ?? rotaDay(-ROTA_BACK_DAYS);
    const before = until ?? rotaDay(ROTA_FORWARD_DAYS);
    const targets = siteMap.size
        ? [...siteMap.entries()].map(([siteId, practiceId]) => ({ siteId, practiceId }))
        : [{ siteId: null, practiceId: null }];

    let synced = 0;
    let fetched = 0;
    const problems = [];

    for (const { siteId, practiceId } of targets) {
        const params = { after, before, include_inactive_practitioners: 'true' };
        if (siteId) params.site_id = siteId;
        let rows;
        let expected = null;
        try {
            // What the server says the window holds, BEFORE walking it. One
            // extra request per site, and the only way to know a walk finished:
            // the pager stops at its page cap by logging and returning
            // normally, so a truncated pull is indistinguishable from a
            // complete one at this level.
            expected = await fetchRotaTotal(orgId, base, auth, params);
            rows = await fetchAllPages(orgId, base, '/rota_practitioner_diaries', auth, params, null, ROTA_MAX_PAGES);
        } catch (err) {
            // Reported, never silently treated as "this site has no rota" — an
            // empty result and a failed request must not look the same.
            problems.push(`site ${siteId ?? 'all'}: ${err?.message || err}`);
            continue;
        }
        // Short of what the server promised: store what came back, but SAY SO,
        // so the caller does not record a partial history as backfilled.
        if (expected !== null && rows.length < expected) {
            problems.push(`site ${siteId ?? 'all'}: fetched ${rows.length} of ${expected} rows`);
        }
        fetched += rows.length;
        const mapped = rows.map((r) => rotaRow(orgId, r, practiceId, siteId)).filter(Boolean);
        if (mapped.length) {
            synced += await upsertChunked(
                'practitioner_rota_days', mapped,
                'organisation_id,pms_practitioner_id,day',
            );
        }
    }

    if (problems.length) console.warn('[dentally] rota pull problems:', problems.join('; '));
    return { since: after, until: before, fetched, synced, problems };
}

/**
 * Rota-only sync, so history can be backfilled or one window refreshed without
 * the heavy patients/appointments/invoice phases. Mirrors syncOpeningHoursOnly.
 */
export async function syncRotaOnly(orgId, integration, window = {}) {
    const base = integration.config?.base_url ?? DEFAULT_BASE;
    const auth = await resolveDentallyAuth(orgId, integration);
    if (!auth) return { error: 'no_auth' };
    const siteMap = await loadSiteMap(orgId);
    return pullRota(orgId, base, auth, siteMap, window);
}

// Opening hours from /sites — the capacity source behind Chair Utilisation.
//
// Sites are mapped to practices by pms_site_id, NEVER by name: two tenants can
// name a practice the same thing, and one tenant can rename one.
//
// A weekday the owner has hand-corrected (source='manual') is left alone. A
// correction that tonight's sync silently undid would be worse than no editor
// at all.
async function pullOpeningHours(orgId, base, auth, siteMap) {
    const sites = await fetchOnePage(base, '/sites', auth, {}).catch(() => []);
    let practices = 0;
    let days = 0;
    const problems = [];

    for (const site of sites) {
        const practiceId = siteMap.get(String(site?.id));
        if (!practiceId) continue; // site not mapped to a practice — nothing to attribute to

        const { rows, errors } = parseOpeningHours(site?.opening_hours);
        for (const e of errors) {
            // Surfaced, not swallowed: an unparseable time renders as closed, so
            // without this an upstream format change would look like a practice
            // that simply shut down.
            problems.push(`site ${site?.id} ${e.day}: ${e.reason}`);
        }

        const manual = await practiceOpeningHoursRepository.manualWeekdays(orgId, practiceId);
        const writable = rows.filter((r) => !manual.has(r.weekday));
        if (!writable.length) continue;

        await practiceOpeningHoursRepository.upsertWeek(orgId, practiceId, writable, 'dentally');
        practices++;
        days += writable.length;
    }

    if (problems.length) console.warn('[dentally] opening-hours parse problems:', problems.join('; '));
    return { practices, days, problems };
}

// Build { dentally practitioner id -> associates.id } for an org so appointments
// resolve an associate_id. Populated by pullPractitioners before the appointment pull.
async function loadPractitionerMap(orgId) {
    const { data } = await supabase_1.serviceClient
        .from('associates')
        .select('id, pms_external_id')
        .eq('organisation_id', orgId)
        .not('pms_external_id', 'is', null);
    const map = new Map();
    for (const a of data ?? []) map.set(String(a.pms_external_id), a.id);
    return map;
}

// Build { dentally practitioner id -> practices.id } for an org. Treatment plan
// ITEMS carry only practitioner_id (no site), so completed treatments attribute
// to a practice via the practitioner's home site — associates.primary_practice_id,
// which pullPractitioners resolved from practitioner.site_id. Validated against
// Dentally's Practitioner Activity report (location filter) to the penny.
async function loadPractitionerPracticeMap(orgId) {
    const { data } = await supabase_1.serviceClient
        .from('associates')
        .select('pms_external_id, primary_practice_id')
        .eq('organisation_id', orgId)
        .not('pms_external_id', 'is', null)
        .not('primary_practice_id', 'is', null);
    const map = new Map();
    for (const a of data ?? []) map.set(String(a.pms_external_id), a.primary_practice_id);
    return map;
}

// Build { dentally patient id -> contacts.id } for the org (source='dentally').
// Paginated: PostgREST caps a select at 1000 rows, so without paging the map
// would silently drop patients beyond the first 1000 and their payments/appts
// would never link a contact.
//
// Paged by KEY, not by OFFSET. .range() makes the server re-walk every skipped
// row, so building one whole-org map is quadratic in contact count — measured
// on the live project, page 28 of a 28k-contact org cost 16,819 shared buffers
// / 29.4ms, against 576 buffers / 5.2ms for the same page fetched by key.
// pms_external_id is the third column of uq_contacts_src_ext and unique within
// (organisation_id, source), so "the rows after the last one I saw" is both
// well defined — no row skipped or repeated at a page boundary — and a plain
// index seek. NULLs are excluded, so the cursor is never null.
//
// Only callers that genuinely need the WHOLE map should use this. To resolve
// the handful of patients one event references, use contactMapFor.
/**
 * Dentally patient id -> the practice that patient belongs to.
 *
 * The SECOND way to attribute a treatment row, and usually the better one. A
 * treatment item or plan carries only a practitioner, and practice was resolved
 * from that alone — so any row whose practitioner is missing from `associates`,
 * or who has no primary_practice_id, came out unattributed even when it was
 * plainly the account's own work. Its PATIENT is the stronger signal: contacts
 * are pulled site-filtered, so a patient we hold is a patient of a practice we
 * selected.
 *
 * Only built when an organisation pulls a subset of its practices — an
 * organisation holding the whole group has nothing to disambiguate.
 */
export async function loadContactPracticeMap(orgId) {
    const map = new Map();
    const PAGE = 1000;
    let after = null;
    for (;;) {
        let query = supabase_1.serviceClient
            .from('contacts')
            .select('pms_external_id, practice_id')
            .eq('organisation_id', orgId)
            .eq('source', 'dentally')
            .not('pms_external_id', 'is', null)
            .order('pms_external_id', { ascending: true })
            .limit(PAGE);
        if (after !== null) query = query.gt('pms_external_id', after);
        const { data, error } = await query;
        if (error) throw new Error(error.message);
        const rows = data ?? [];
        for (const c of rows) if (c.practice_id) map.set(String(c.pms_external_id), c.practice_id);
        if (rows.length < PAGE) break;
        after = rows[rows.length - 1].pms_external_id;
    }
    return map;
}

export async function loadContactMap(orgId) {
    const map = new Map();
    const PAGE = 1000;
    let after = null;
    for (;;) {
        let query = supabase_1.serviceClient
            .from('contacts')
            .select('id, pms_external_id')
            .eq('organisation_id', orgId)
            .eq('source', 'dentally')
            .not('pms_external_id', 'is', null)
            .order('pms_external_id', { ascending: true })
            .limit(PAGE);
        if (after !== null) query = query.gt('pms_external_id', after);
        const { data, error } = await query;
        if (error) throw new Error(error.message);
        const rows = data ?? [];
        for (const c of rows) map.set(String(c.pms_external_id), c.id);
        if (rows.length < PAGE) break;
        after = rows[rows.length - 1].pms_external_id;
    }
    return map;
}

// Resolve JUST the contacts one webhook event references, keyed exactly as
// loadContactMap keys its map so the row builders below are untouched.
//
// The webhook path used to call loadContactMap(orgId) to answer a ONE-patient
// question, paging the org's entire contact table to do it. On the live project
// that single query was 65.6% of all database time (1,733,431 calls @ 114.9ms).
// This lookup is covered end to end by uq_contacts_src_ext (organisation_id,
// source, pms_external_id): measured at 3 shared buffers / 0.13ms against the
// ~400,000 buffers and 2.5-3.5s a full map build costs for a 28k-contact org.
//
// An event with no patient (a diary block, a standalone invoice_item) issues no
// query at all rather than a lookup that can only return nothing.
async function contactMapFor(orgId, patientIds) {
    const ids = [...new Set(patientIds.filter((v) => v != null).map(String))];
    const map = new Map();
    if (!ids.length) return map;
    const { data, error } = await supabase_1.serviceClient
        .from('contacts')
        .select('id, pms_external_id')
        .eq('organisation_id', orgId)
        .eq('source', 'dentally')
        .in('pms_external_id', ids);
    if (error) throw new Error(`contact lookup: ${error.message}`);
    for (const c of data ?? []) map.set(String(c.pms_external_id), c.id);
    return map;
}

// ---- row builders (shared by polling + webhooks) ----------------------------
// One Dentally record -> one of our table rows. Pure (no I/O) so the poll and
// the webhook receiver map IDENTICALLY. appointment/payment return null when the
// site_id maps to no practice (those tables' practice_id is NOT NULL → skipped).

export function patientRow(orgId, p, siteMap) {
    return {
        organisation_id: orgId,
        source: 'dentally',
        pms_external_id: String(p.id),
        type: 'patient',
        first_name: p.first_name ?? null,
        last_name: p.last_name ?? null,
        // Dentally returns email only as `email_address`. The old `?? p.email`
        // fallback referenced a field Dentally never sends, so it was dead.
        email: p.email_address ?? null,
        // Dentally has mobile_phone / home_phone / work_phone (no `phone_number`,
        // the old fallback was dead). A patient with only a home/work number used
        // to store null -> the list showed "—". Walk the three real fields.
        phone: p.mobile_phone ?? p.home_phone ?? p.work_phone ?? null,
        date_of_birth: p.date_of_birth ?? null,
        // Populate the typed address/postcode/recall columns the sync used to
        // leave empty. address_line_1 -> address (single col); recall = whichever
        // of the dentist/hygienist due dates is set.
        address: p.address_line_1 ?? null,
        postcode: p.postcode ?? null,
        next_recall_date: p.dentist_recall_date ?? p.hygienist_recall_date ?? null,
        practice_id: siteMap.get(String(p.site_id)) ?? null,
        // Real Dentally registration timestamp -> drives the "new patients"
        // metric (migration 000073). NOT contacts.created_at, which is our
        // sync insert time. Falls back through Dentally's date variants.
        pms_registered_at: p.created_at ?? p.registered_at ?? p.date_of_registration ?? null,
        // Full curated Dentally patient detail (migration 000082) — backs the
        // read-only patient detail dialog. Display-only PII; excluded from the
        // AI context snapshot.
        pms_patient: patientDetailBlob(p),
    };
}

// Whitelist the Dentally patient fields we surface in the detail dialog. Pure
// pick (no nesting) so we never store unexpected nested objects/arrays, and the
// shape stays stable for the frontend. null-coalesce everything to null.
function patientDetailBlob(p) {
    const pick = (k) => p[k] ?? null;
    return {
        title: pick('title'),
        first_name: pick('first_name'),
        middle_name: pick('middle_name'),
        last_name: pick('last_name'),
        preferred_name: pick('preferred_name'),
        // Dentally gender is a boolean (true = male, false = female).
        gender: typeof p.gender === 'boolean' ? p.gender : null,
        date_of_birth: pick('date_of_birth'),
        // Contact
        email_address: pick('email_address'),
        mobile_phone: pick('mobile_phone'),
        home_phone: pick('home_phone'),
        work_phone: pick('work_phone'),
        preferred_phone_number: pick('preferred_phone_number'),
        recall_method: pick('recall_method'),
        use_email: typeof p.use_email === 'boolean' ? p.use_email : null,
        use_sms: typeof p.use_sms === 'boolean' ? p.use_sms : null,
        marketing: pick('marketing'),
        // Address
        address_line_1: pick('address_line_1'),
        address_line_2: pick('address_line_2'),
        county: pick('county'),
        town: pick('town'),
        postcode: pick('postcode'),
        // Identifiers / misc
        nhs_number: pick('nhs_number'),
        ni_number: pick('ni_number'),
        occupation: pick('occupation'),
        payment_plan_id: pick('payment_plan_id'),
        active: typeof p.active === 'boolean' ? p.active : null,
        // Recalls
        dentist_id: pick('dentist_id'),
        dentist_recall_date: pick('dentist_recall_date'),
        dentist_recall_interval: pick('dentist_recall_interval'),
        hygienist_id: pick('hygienist_id'),
        hygienist_recall_date: pick('hygienist_recall_date'),
        hygienist_recall_interval: pick('hygienist_recall_interval'),
        // Emergency contact
        emergency_contact_name: pick('emergency_contact_name'),
        emergency_contact_relationship: pick('emergency_contact_relationship'),
        emergency_contact_phone: pick('emergency_contact_phone_normalized') ?? pick('emergency_contact_phone'),
        // Clinical flag (summary text included — display only, never sent to AI)
        medical_alert: typeof p.medical_alert === 'boolean' ? p.medical_alert : null,
        medical_alert_text: pick('medical_alert_text'),
        // Provenance
        acquisition_source_id: pick('acquisition_source_id'),
        image_url: pick('image_url'),
        created_at: pick('created_at'),
        updated_at: pick('updated_at'),
    };
}

export function practitionerRow(orgId, p, siteMap) {
    // Dentally nests the human name under `user` (verified against live API):
    // practitioner.user.{title,first_name,last_name,email}. The practitioner
    // record itself carries no name, which is why the old top-level guesses fell
    // through to "Practitioner <id>". Prefer user.*, then any legacy top-level
    // fields, then the id fallback.
    const u = p.user ?? {};
    const name = [u.title, u.first_name, u.last_name].filter(Boolean).join(' ').trim()
        || p.name
        || [p.first_name, p.last_name].filter(Boolean).join(' ').trim()
        || `Practitioner ${p.id}`;
    // contract_targets is an array (a practitioner can hold several NHS contracts);
    // total UDA/UOA target = sum across them. 0 -> null so the UI shows "—" not "0".
    const targets = Array.isArray(p.contract_targets) ? p.contract_targets : [];
    const udaTarget = targets.reduce((s, t) => s + (Number(t.uda_target) || 0), 0) || null;
    const uoaTarget = targets.reduce((s, t) => s + (Number(t.uoa_target) || 0), 0) || null;
    return {
        organisation_id: orgId,
        pms_external_id: String(p.id),
        full_name: name,
        email: u.email ?? p.email_address ?? p.email ?? null,
        primary_practice_id: siteMap.get(String(p.site_id)) ?? null,
        active: p.active !== false,
        // Dentally user.id — the human behind the practitioner record. The SAME
        // person has a SEPARATE practitioner row per site (distinct practitioner.id
        // + site_id) but ONE shared user.id, so this is the key the roster groups
        // on to collapse per-site duplicates into one clinician (migration 000081).
        pms_user_id: u.id != null ? String(u.id) : null,
        // Practitioner-endpoint metadata (migration 000080). Dentally is the source
        // for these synced practitioners, so a missing value legitimately clears it.
        gdc_number: p.gdc_number ?? null,
        nhs_number: p.nhs_number ?? null,
        colour: p.colour ?? null,
        dentally_role: u.role ?? null,
        uda_target: udaTarget,
        uoa_target: uoaTarget,
    };
}

// Coarse-bucket a free-text Dentally role into the staff.role enum. The exact
// PMS label is preserved separately in pms_role for display; this is only for
// the constrained column. Unknown/clinical roles (e.g. "Dentist") -> 'other'.
export function mapDentallyRole(raw) {
    const r = String(raw || '').toLowerCase();
    if (r.includes('recept')) return 'reception';
    if (r.includes('nurse')) return 'nurse';
    if (r.includes('hygien')) return 'hygienist';
    if (r.includes('therap')) return 'therapist';
    if (r.includes('coordinator') || r === 'tco') return 'tco';
    if (r.includes('manager')) return 'manager';
    return 'other';
}

// Dentally `/users` = the practice team roster. Verified live fields:
// { id, title, first_name, last_name, email, mobile_phone, role, site_id,
//   practice_id, last_login }. HR data (rate/hours/attendance) is NOT in
// Dentally, so those staff columns stay null/owner-entered.
export function staffRow(orgId, u, siteMap) {
    const name = [u.title, u.first_name, u.last_name].filter(Boolean).join(' ').trim()
        || [u.first_name, u.last_name].filter(Boolean).join(' ').trim()
        || `User ${u.id}`;
    return {
        organisation_id: orgId,
        source: 'dentally',
        pms_external_id: String(u.id),
        full_name: name,
        role: mapDentallyRole(u.role),
        pms_role: u.role ?? null,
        email: u.email ?? null,
        phone: u.mobile_phone ?? null,
        title: u.title ?? null,
        last_login_at: u.last_login ?? null,
        // Resolve the Dentally site to a practice (same map as practitioners).
        practice_id: siteMap.get(String(u.site_id)) ?? null,
        active: true,
    };
}

export function appointmentRow(orgId, a, siteMap, contactMap, practitionerMap = new Map()) {
    // Dentally appointments expose the site as `practitioner_site_id` (no plain
    // `site_id`); fall back to site_id for other shapes. Verified against live API.
    const practiceId = siteMap.get(String(a.practitioner_site_id ?? a.site_id));
    if (!practiceId) return null;
    // appointments.starts_at is NOT NULL — some Dentally rows (e.g. unscheduled)
    // carry no start_time, so skip them rather than fail the whole upsert chunk.
    const startsAt = a.start_time ?? a.start ?? null;
    if (!startsAt) return null;
    return {
        organisation_id: orgId,
        source: 'dentally',
        pms_external_id: String(a.id),
        // Raw Dentally patient id, persisted so contact_id can be relinked later
        // (relink_dentally_appointment_contacts) when the patient is pulled in a
        // different run. null for patient-less diary blocks.
        pms_patient_id: a.patient_id != null ? String(a.patient_id) : null,
        // Raw Dentally practitioner id, persisted so associate_id can be relinked
        // later (relink_dentally_appointment_associates) when practitioners are
        // pulled/mapped in a different run — without re-pulling appointments.
        pms_practitioner_id: a.practitioner_id != null ? String(a.practitioner_id) : null,
        practice_id: practiceId,
        contact_id: contactMap.get(String(a.patient_id)) ?? null,
        starts_at: startsAt,
        // appointments.ends_at is NOT NULL; some Dentally rows omit a finish
        // time. Fall back to starts_at so the row stores instead of failing the
        // upsert and being silently dropped.
        ends_at: a.finish_time ?? a.finish ?? a.end_time ?? startsAt,
        status: mapAppointmentStatus(a.state ?? a.status),
        // Treatment label for the Treatment Mix view. Dentally exposes the
        // appointment's purpose as free-text `reason`; some shapes carry an
        // explicit `appointment_type`. Null when neither is present. Verify the
        // field name against the sandbox during UAT.
        appointment_type: a.appointment_type ?? a.reason ?? null,
        // Dentally appointments carry a practitioner_id; resolve it to an
        // associate (null if the practitioner hasn't been pulled/mapped yet).
        // Verify the field name against the sandbox during UAT.
        associate_id: practitionerMap.get(String(a.practitioner_id)) ?? null,
    };
}

export function paymentRow(orgId, p, siteMap, contactMap) {
    if (p?.deleted === true) return null; // Dentally soft-deletes; don't ingest
    const practiceId = siteMap.get(String(p.site_id));
    if (!practiceId) return null;
    return {
        organisation_id: orgId,
        source: 'dentally',
        external_id: String(p.id),
        practice_id: practiceId,
        contact_id: contactMap.get(String(p.patient_id)) ?? null,
        amount_pence: toPence(p.amount),
        method: mapPaymentMethod(p.method ?? p.payment_method),
        // Dentally payments date field is `dated_on`. Verified against live API.
        status: mapPaymentStatus(p),
        processed_at: p.dated_on ?? p.payment_date ?? p.paid_at ?? p.created_at ?? null,
    };
}

// Treatment plan = per-practitioner production (the figure the Associate Pay
// Run needs; absent from the appointment/payment feeds). Verified shape against
// the live API: { id, practitioner_id, patient_id, private_treatment_value,
// nhs_uda_value, nhs_completed_uda_value, completed, completed_at, start_date,
// end_date }. private_treatment_value is money -> integer pence; UDA values are
// units, kept numeric. associate_id/contact_id resolved via the existing maps;
// raw ids persisted so they can be relinked on a later run. practice_id: the
// feed carries no site, so (like treatment items) attribute via the
// practitioner's home site — practiceByPractitioner from
// loadPractitionerPracticeMap; restamp_treatment_plan_practices self-heals
// rows whose practitioner joined the roster later.
export function treatmentPlanRow(orgId, tp, associateMap = new Map(), contactMap = new Map(), practiceByPractitioner = new Map(), practiceByContact = new Map()) {
    const numOrNull = (v) => (v == null || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
    const prac = tp.practitioner_id != null ? String(tp.practitioner_id) : null;
    // Practitioner first, then the patient — see treatmentItemRow.
    const practiceId = (prac ? practiceByPractitioner.get(prac) : null)
        ?? practiceByContact.get(String(tp.patient_id))
        ?? null;
    return {
        organisation_id: orgId,
        source: 'dentally',
        pms_external_id: String(tp.id),
        practice_id: practiceId,
        pms_practitioner_id: tp.practitioner_id != null ? String(tp.practitioner_id) : null,
        pms_patient_id: tp.patient_id != null ? String(tp.patient_id) : null,
        associate_id: associateMap.get(String(tp.practitioner_id)) ?? null,
        contact_id: contactMap.get(String(tp.patient_id)) ?? null,
        private_value_pence: toPence(tp.private_treatment_value),
        nhs_uda_value: numOrNull(tp.nhs_uda_value),
        nhs_completed_uda_value: numOrNull(tp.nhs_completed_uda_value),
        completed: tp.completed === true,
        completed_at: tp.completed_at ?? null,
        start_date: tp.start_date ?? null,
        end_date: tp.end_date ?? null,
    };
}

// Treatment plan ITEM = one completed-treatment line — the feed behind Dentally's
// "Practitioner Activity" report. Verified live shape (GET /treatment_plan_items):
// { id, completed, completed_at, base_chart, price (money string), duration,
//   practitioner_id, patient_id, treatment_plan_id, treatment_appointment_id,
//   invoice_id, charged, appear_on_invoice, nomenclature, patient_nomenclature }.
// SENSITIVE clinical fields the payload also carries (teeth, surfaces, notes,
// custom_fields) are deliberately NOT read — matches the connector's data-
// minimisation policy. practice_id resolves via the practitioner's home site
// (practiceByPractitioner); associate_id / contact_id via the existing maps.
// price is a money STRING -> integer pence. base_chart=true rows are tooth/surface
// charting noise Dentally excludes from the report; we store the flag and let the
// rollup RPC filter, so both report semantics stay available.
export function treatmentItemRow(orgId, it, practiceByPractitioner = new Map(), associateMap = new Map(), contactMap = new Map(), practiceByContact = new Map()) {
    const prac = it.practitioner_id != null ? String(it.practitioner_id) : null;
    const dur = Number(it.duration);
    // Practitioner first (it names who did the work), patient second. Without
    // the fallback a practitioner missing from `associates` — a locum, a
    // leaver, anyone the roster pull has not reached — left the row
    // unattributed and invisible to every per-practice figure.
    const practiceId = (prac ? practiceByPractitioner.get(prac) : null)
        ?? practiceByContact.get(String(it.patient_id))
        ?? null;
    return {
        organisation_id: orgId,
        source: 'dentally',
        pms_external_id: String(it.id),
        pms_practitioner_id: prac,
        pms_patient_id: it.patient_id != null ? String(it.patient_id) : null,
        practice_id: practiceId,
        contact_id: contactMap.get(String(it.patient_id)) ?? null,
        associate_id: prac ? (associateMap.get(prac) ?? null) : null,
        treatment_plan_id: it.treatment_plan_id != null ? String(it.treatment_plan_id) : null,
        treatment_appointment_id: it.treatment_appointment_id != null ? String(it.treatment_appointment_id) : null,
        pms_invoice_id: it.invoice_id != null ? String(it.invoice_id) : null,
        // patient_nomenclature is the patient-facing treatment label; fall back to
        // the clinical nomenclature when absent.
        treatment_name: it.patient_nomenclature ?? it.nomenclature ?? null,
        price_pence: toPence(it.price),
        duration: Number.isFinite(dur) && dur > 0 ? dur : 0,
        completed: it.completed === true,
        completed_at: it.completed_at ?? null,
        base_chart: it.base_chart === true,
        charged: it.charged === true,
        appear_on_invoice: it.appear_on_invoice === true,
    };
}

// Invoice item = the REAL per-treatment fee line. Verified live shape:
// { id, name, item_price, total_price, quantity, nhs_charge, invoice_id,
//   practitioner_id, treatment_plan_id, treatment_plan_item_id }. The item
// itself carries no practice/date — those come from its parent invoice (site_id
// + patient_id + dated_on), resolved via `invoiceMap` (dentally invoice id ->
// { practice_id, contact_id, dated_on, paid }) so the row is self-contained.
// item_price/total_price arrive as money STRINGS -> integer pence (toPence).
export function invoiceItemRow(orgId, it, invoiceMap = new Map(), practitionerMap = new Map()) {
    const inv = invoiceMap.get(String(it.invoice_id)) || {};
    const qty = Number(it.quantity);
    return {
        organisation_id: orgId,
        source: 'dentally',
        pms_external_id: String(it.id),
        pms_invoice_id: it.invoice_id != null ? String(it.invoice_id) : null,
        pms_practitioner_id: it.practitioner_id != null ? String(it.practitioner_id) : null,
        practice_id: inv.practice_id ?? null,
        contact_id: inv.contact_id ?? null,
        associate_id: practitionerMap.get(String(it.practitioner_id)) ?? null,
        treatment_plan_id: it.treatment_plan_id != null ? String(it.treatment_plan_id) : null,
        treatment_name: it.name ?? null,
        unit_price_pence: toPence(it.item_price),
        // total_price is qty-inclusive; fall back to unit price when absent.
        fee_pence: toPence(it.total_price ?? it.item_price),
        quantity: Number.isFinite(qty) && qty > 0 ? qty : 1,
        nhs_charge: it.nhs_charge === true,
        invoiced_on: inv.dated_on ?? null,
        invoice_paid: inv.paid ?? null,
    };
}

// Summarise an invoice's line items into a single treatment label for the debt
// table. >1 item -> "Multiple items"; else the first item's treatment name.
function invoiceTreatment(items) {
    if (!Array.isArray(items) || items.length === 0) return null;
    if (items.length > 1) return 'Multiple items';
    const it = items[0];
    return it?.treatment ?? it?.name ?? it?.description ?? null;
}

export function invoiceRow(orgId, inv, siteMap, contactMap) {
    const practiceId = siteMap.get(String(inv.site_id));
    if (!practiceId) return null; // invoices.practice_id is NOT NULL
    return {
        organisation_id: orgId,
        source: 'dentally',
        external_id: String(inv.id),
        practice_id: practiceId,
        contact_id: contactMap.get(String(inv.patient_id)) ?? null,
        // UAT: Dentally money units are ambiguous (docs say `amount` is "integer";
        // the payments path treats it as pounds-decimal). Use toPence for
        // consistency; verify pence-vs-pounds against the sandbox during UAT.
        amount_pence: toPence(inv.amount),
        amount_outstanding_pence: toPence(inv.amount_outstanding),
        dated_on: inv.dated_on ?? null,
        due_on: inv.due_on ?? null,
        paid: inv.paid === true,
        treatment: invoiceTreatment(inv.invoice_items),
        patient_name: inv.patient_name ?? null,
    };
}

// ---- site scoping -----------------------------------------------------------

/**
 * The Dentally sites this organisation is allowed to pull, or null for "every
 * site" — which is what an org connected before the picker existed does, and
 * what a single-site tenant keeps doing. Null is deliberately NOT an empty Set:
 * the two must never be confused, because an empty Set means "pull nothing".
 *
 * This exists because a Dentally OAuth grant is GROUP-wide. A sub-account that
 * should hold one practice gets a token that can read all of them, and on a
 * live connect that pulled 9,446 patients and 21,800 appointments belonging to
 * four other practices into one sub-account before it was stopped.
 */
export function allowedSites(integration) {
    const ids = integration?.config?.site_ids;
    if (!Array.isArray(ids) || ids.length === 0) return null;
    return new Set(ids.map(String));
}

/** True when a record's site is one this organisation pulls. */
export function keepSite(allowed, siteId) {
    return !allowed || allowed.has(String(siteId));
}

/**
 * Request params that make Dentally send only the sites this organisation
 * pulls, so a practice it did not select is never transferred at all.
 *
 * Verified against the live API — `site_id` narrows EVERY collection: patients
 * 9,553 -> 4,108, appointments 33,828 -> 12,675, payments 13,138 -> 5,103,
 * invoices 23,721 -> 9,294, practitioners 218 -> 75, users 270 -> 99.
 *
 * The filter takes ONE value, so several selected sites become several filtered
 * passes (expanded by sitePasses at the fetch layer) — never one unfiltered
 * pass that downloads the group and discards most of it.
 *
 * keepSite still runs on the rows that come back. Correctness must never depend
 * on a remote filter we cannot unit-test — the same reason isOpenAppointment
 * re-checks the server-side `after` filter locally.
 */
export function siteRequestParams(allowed) {
    if (!allowed || allowed.size === 0) return {};
    return { __sites: [...allowed] };
}

/**
 * Scope for the reconcilers, which compare OUR rows against Dentally's.
 *
 * BOTH SIDES MUST BE SCOPED THE SAME WAY. A remote set narrowed to one practice
 * compared against local rows from several marks every row of the others as
 * deleted-upstream, and the delete reconcilers act on that: de-selecting a
 * practice would quietly erase its clinical history on the next nightly run.
 * Removing a practice's data must be an explicit act, never a filter's side
 * effect.
 *
 * Dentally's site_id takes ONE value and these functions build their own URLs,
 * so the narrowing applies when exactly one site is selected — every
 * sub-account today, and where all the volume is. With none or several selected
 * BOTH sides stay unfiltered: the remote set is then a superset of anything we
 * hold, so a row can only be deleted because Dentally really dropped it.
 */
async function reconcileScope(orgId, allowed) {
    const NONE = { params: {}, practiceIds: null };
    if (!allowed || allowed.size !== 1) return NONE;
    const site = [...allowed][0];
    const siteMap = await loadSiteMap(orgId);
    const practiceId = siteMap.get(String(site));
    // No practice row for the site means the local side cannot be scoped, so
    // the remote side must not be either — an asymmetric scope is the bug.
    if (!practiceId) return NONE;
    return { params: { site_id: site }, practiceIds: [practiceId] };
}

/**
 * Drop rows whose practice could not be resolved, when the organisation pulls
 * only some of the group's practices.
 *
 * appointments, payments, invoices and contacts are protected already: their
 * practice_id is NOT NULL, so a row whose site maps to no practice is skipped.
 * treatment_plans, dentally_treatment_items and invoice_items have a NULLABLE
 * practice_id and store the row anyway — which is right for an organisation
 * that holds the whole group (unattributed is still theirs) and wrong for one
 * scoped to a single practice, where an unresolvable practice means the record
 * belongs to a practice it did not select.
 *
 * Measured live before this existed: the Rochester sub-account held 64,165
 * treatment items, 10,792 invoice items and 7,700 treatment plans with a null
 * practice — other practices' records — and the Treatments Completed card
 * counted them all. It read 1,981 for June against 775 that were actually
 * Rochester's, and 341 for a September week against Dentally's own 96.
 *
 * Only applied when a selection exists. An organisation that pulls everything
 * keeps its unattributed rows, exactly as before.
 */
function dropsUnattributed(allowed) {
    return Boolean(allowed && allowed.size > 0);
}

// ---- pulls ------------------------------------------------------------------

// The three pulls below are the ONLY ones that need an explicit site gate.
// Appointments, payments and invoices already drop a record whose site maps to
// no practice, because those tables have a NOT NULL practice_id — so limiting
// which practices exist limits them for free. Patients, practitioners and staff
// set `practice_id: null` and insert anyway (patientRow line ~607), so without
// this they land in full whatever the practice list says.

async function pullPatients(orgId, base, auth, params, siteMap, onPage, maxPages, allowed = null) {
    let synced = 0;
    // The page reporter is wrapped so every tick carries how many records were
    // KEPT alongside how many were read. Without it the overlay says "9,450
    // pulled" for an account holding 4,061 — both true, neither labelled.
    const report = onPage ? (page, totalPages, count) => onPage(page, totalPages, count, synced) : onPage;
    await streamPages(orgId, base, '/patients', auth, params, async (items) => {
        const rows = items
            .filter((p) => keepSite(allowed, p?.site_id))
            .map((p) => patientRow(orgId, p, siteMap));
        synced += await upsertChunked('contacts', rows, 'organisation_id,source,pms_external_id');
    }, report, maxPages);
    return { synced };
}

async function pullPractitioners(orgId, base, auth, params, siteMap, maxPages, allowed = null) {
    const remote = await fetchAllPages(orgId, base, '/practitioners', auth, params, null, maxPages);
    const rows = remote
        .filter((p) => p && p.id != null && keepSite(allowed, p.site_id))
        .map((p) => practitionerRow(orgId, p, siteMap));
    // Upsert on the new (organisation_id, pms_external_id) arbiter. pay_pct /
    // lab_split_pct are NOT in the payload, so owner-set values are preserved.
    const synced = await upsertChunked('associates', rows, 'organisation_id,pms_external_id');
    return { synced };
}

// Practitioners-only sync — cheap (the whole-practice clinician set, a handful of
// pages). Pulls EVERY practitioner (no updated_after filter) so it backfills the
// practitioner-endpoint metadata (gdc/colour/role/uda_target) + pms_user_id on
// existing rows without running the heavy patients/appointments/invoice phases.
export async function syncPractitionersOnly(orgId, integration) {
    const base = integration.config?.base_url ?? DEFAULT_BASE;
    const auth = await resolveDentallyAuth(orgId, integration);
    if (!auth) return { error: 'no_auth' };
    const siteMap = await loadSiteMap(orgId);
    return pullPractitioners(orgId, base, auth, {}, siteMap, BACKFILL_MAX_PAGES, allowedSites(integration));
}

// Dentally `/users` -> staff roster. Small set (whole-practice team), so one
// unfiltered pull each sync; upsert is idempotent on (org, source, pms id).
async function pullUsers(orgId, base, auth, params, siteMap, maxPages, allowed = null) {
    const remote = await fetchAllPages(orgId, base, '/users', auth, params, null, maxPages);
    const rows = remote
        .filter((u) => u && u.id != null && keepSite(allowed, u.site_id))
        .map((u) => staffRow(orgId, u, siteMap));
    const synced = await upsertChunked('staff', rows, 'organisation_id,source,pms_external_id');
    return { synced };
}

// openOnly (the first pull): keep only upcoming + not-yet-closed appointments.
// Even when the server-side `after` filter narrows the set, enforce it here too
// so correctness never depends on a remote filter we can't unit-test.
export function isOpenAppointment(row, now = Date.now()) {
    if (CLOSED_APPT_STATES.has(row.status)) return false;
    return new Date(row.starts_at).getTime() >= now;
}

async function pullAppointments(orgId, base, auth, params, siteMap, contactMap, onPage, maxPages, { openOnly = false, practitionerMap = new Map() } = {}) {
    const now = Date.now();
    let synced = 0;
    let skipped = 0;       // unmatched practice (NOT NULL practice_id) — a data-mapping gap
    let skippedClosed = 0; // dropped by the first-pull open filter — expected, not a gap
    await streamPages(orgId, base, '/appointments', auth, params, async (items) => {
        const rows = [];
        for (const a of items) {
            const row = appointmentRow(orgId, a, siteMap, contactMap, practitionerMap);
            if (!row) { skipped++; continue; } // appointments.practice_id is NOT NULL
            if (openOnly && !isOpenAppointment(row, now)) { skippedClosed++; continue; }
            rows.push(row);
        }
        synced += await upsertChunked('appointments', rows, 'organisation_id,source,pms_external_id');
    }, onPage, maxPages);
    return { synced, skipped, skippedClosed };
}

// DELIBERATELY NOT SITE-FILTERED — the delete reconcilers below fetch the whole
// group's remote set, and that is a safety property, not an oversight.
//
// They delete OUR rows that are absent from the remote set. Fetching the group
// makes the remote set a SUPERSET of anything we hold, so a row can only be
// deleted because Dentally really dropped it. Narrowing the remote side to the
// currently-selected sites would mean that de-selecting a practice makes every
// row we already hold for it look deleted-upstream, and the next nightly
// reconcile would quietly erase real clinical history as a side effect of a
// settings change. Removing a practice's data must be an explicit act, never a
// consequence of a filter.
//
// The cost is one unfiltered page-through per reconcile. The pulls themselves
// are filtered, which is where the volume is.
//
// Pure decision step for the delete-reconciliation below, factored out so the
// safety rules are unit-testable without hitting Dentally or the DB. Given our
// dentally appointment rows in a window and the authoritative set of ids Dentally
// still returns for that window, decide which of our rows are stale (Dentally no
// longer has them) and therefore safe to delete.
//   - empty remote set -> abort (a window with rows on our side but none on
//     Dentally's almost always means a bad/partial pull, not a mass deletion).
//   - would delete more than maxDeleteShare of the window -> abort (a silent
//     remote-shape change must never wipe a large share of real rows).
export function selectStaleAppointmentIds(ourRows, remoteIdSet, { maxDeleteShare = 0.5 } = {}) {
    const stale = (ourRows || []).filter((r) => r.pms_external_id != null && !remoteIdSet.has(String(r.pms_external_id)));
    if (!ourRows || ourRows.length === 0) return { ids: [], aborted: null };
    if (remoteIdSet.size === 0) return { ids: [], aborted: 'empty_remote' };
    if (stale.length > ourRows.length * maxDeleteShare) return { ids: [], aborted: 'safety_threshold' };
    return { ids: stale.map((r) => r.id), aborted: null };
}

// Window-scoped delete reconciliation. Dentally's incremental `updated_after` feed
// never returns DELETED appointments (they are simply gone), so an upsert-only
// sync keeps stale rows forever and our appointment counts drift ABOVE Dentally's
// (e.g. our 385 vs Dentally's 384 for a day window). Pull the AUTHORITATIVE id set
// for a bounded appointment-date window, then delete our dentally-sourced rows in
// that window whose pms id Dentally no longer returns.
//
// Safety (this function deletes patient rows, so it is fail-closed):
//   - only ever deletes rows with source='dentally' inside [sinceISO, untilISO);
//   - the remote pull is padded ±1 day so a date-filter boundary/timezone skew
//     can only make the remote set a SUPERSET of our window, never miss a row;
//   - ABORTS (deletes nothing) unless it FULLY paged the window — any page-cap
//     hit, HTTP error, fetch error, or empty/ambiguous body is treated as
//     "unknown", never as "Dentally deleted these";
//   - the pure selectStaleAppointmentIds guard aborts on an empty remote set or
//     an implausibly large delete share.
// Dentally /appointments filters by appointment date via `after`/`before` (the
// same `after` the upcoming-diary pull already relies on); if `before` is ignored
// by a tenant the pull simply returns a superset and either still pages fully or
// trips the page cap and aborts — both safe.
export async function reconcileDeletedAppointments(orgId, base, auth, { sinceISO, untilISO, maxPages = MAX_PAGES, allowed = null } = {}) {
    // Remote and local are narrowed together or not at all. See reconcileScope.
    const scope = await reconcileScope(orgId, allowed);
    if (!sinceISO || !untilISO) return { deleted: 0, aborted: 'no_window' };
    const pad = 86400000; // ±1 day, in ms
    const after = new Date(Date.parse(sinceISO) - pad).toISOString();
    const before = new Date(Date.parse(untilISO) + pad).toISOString();
    const params = { after, before, cancelled: true };
    // Fully-paged, completeness-tracked pull of the window's current ids.
    const remoteIds = new Set();
    let page = 1;
    let complete = false;
    for (;;) {
        const url = new URL(`${base}/appointments`);
        for (const [k, v] of Object.entries(scope.params)) url.searchParams.set(k, String(v));
        for (const [k, v] of Object.entries({ ...params, page, per_page: PER_PAGE })) url.searchParams.set(k, String(v));
        const { res, aborted: fetchAborted } = await fetchReconcilePage(url, auth);
        if (fetchAborted) return { deleted: 0, aborted: fetchAborted }; // partial -> never delete
        const body = await res.json();
        const key = Object.keys(body).find((k) => Array.isArray(body[k]));
        const items = key ? body[key] : [];
        for (const a of items) if (a?.id != null) remoteIds.add(String(a.id));
        const totalPages = body.meta?.total_pages;
        const done = totalPages ? page >= totalPages : items.length < PER_PAGE;
        if (done) { complete = true; break; }
        if (page >= maxPages) break; // window too big to fully page -> abort below
        page++;
        await sleep(RATE_DELAY_MS);
    }
    if (!complete) return { deleted: 0, aborted: 'page_cap' };
    // Our dentally appointments in the SAME (unpadded) window. Page the select
    // (PostgREST caps at 1000 rows) so we never miss rows past the first page.
    const ourRows = [];
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
        let q = supabase_1.serviceClient
            .from('appointments')
            .select('id, pms_external_id')
            .eq('organisation_id', orgId)
            .eq('source', 'dentally')
            .gte('starts_at', sinceISO)
            .lt('starts_at', untilISO)
            .not('pms_external_id', 'is', null);
        // Same narrowing as the remote fetch above. Rows for a practice the
        // remote set no longer covers are excluded from the comparison rather
        // than treated as deleted upstream.
        if (scope.practiceIds) q = q.in('practice_id', scope.practiceIds);
        const { data, error } = await q.range(from, from + PAGE - 1);
        if (error) return { deleted: 0, aborted: 'db_read_error' };
        const rows = data ?? [];
        ourRows.push(...rows);
        if (rows.length < PAGE) break;
    }
    const { ids: staleIds, aborted } = selectStaleAppointmentIds(ourRows, remoteIds);
    if (aborted) return { deleted: 0, aborted, remote: remoteIds.size, scanned: ourRows.length };
    let deleted = 0;
    for (let i = 0; i < staleIds.length; i += 500) {
        const chunk = staleIds.slice(i, i + 500);
        const { error } = await supabase_1.serviceClient.from('appointments').delete().in('id', chunk);
        if (!error) deleted += chunk.length;
    }
    return { deleted, remote: remoteIds.size, scanned: ourRows.length };
}

// ============================================================================
// BACKFILL reconciliation — the missing half of an `updated_after` sync.
//
// Every heavy pull in this file is driven by `updated_after`, so it only ever
// sees what Dentally CHANGED since the last run. That makes any miss permanent:
// if a record never lands (or is removed after the fact), its `updated_at` stays
// frozen in the past while our cursor moves forward, and no future incremental
// pull can ever return it again. There is delete-reconciliation for rows
// Dentally REMOVED and, until now, nothing at all for rows we simply do not
// have — so the error could only accumulate, which is exactly why the gap grows
// the further back you look.
//
// Measured on the live project 2026-09-07, Rochester August 2026: Dentally
// reported 620 patient appointments against our 605. All 15 still exist in
// Dentally, all carry a mapped site, a valid start/finish and a patient we hold
// as a contact, and replaying the sync's own pull shape returned all 15 across
// 54 complete pages with no duplicates. Nothing about the fetch or the mapping
// was wrong — the rows just were not in the table, and the cursor could never go
// back for them.
//
// DELIBERATE ASYMMETRY with the delete prunes above. Those are fail-CLOSED: a
// partial remote set makes healthy rows look deleted, so they abort rather than
// act on incomplete data. This is fail-OPEN: writing back a record Dentally just
// handed us cannot destroy anything, so a short pull restores what it saw and
// the next run picks up the rest. Getting these two backwards in either
// direction is the dangerous mistake.
//
// Only rows we do NOT already hold are written. A blanket re-upsert of the
// window would be simpler and wrong: it would rewrite thousands of rows a night,
// and could blank a column the row builder has no value for, to fix a handful of
// gaps.
//
// Generic over the resource, because this is not an appointments problem — every
// `updated_after` feed in this file has the same one-way ratchet.
// ============================================================================
// `prepare` is an optional per-PAGE hook returning context the row builder
// needs but the record does not carry — an invoice_item holds only invoice_id
// and has to resolve its parent's practice / contact / date / paid status. Per
// page, not per row: one lookup for a hundred ids instead of a hundred lookups,
// and without holding a whole-org map in memory. The poll path solves the same
// problem the same way (loadInvoiceContext).
export async function reconcileMissingRecords(orgId, base, auth, {
    path, params = {}, table, idCol, onConflict, buildRow, prepare = null,
    maxPages = WINDOW_RECON_MAX_PAGES, collectRemoteIds = false,
} = {}) {
    let restored = 0;
    let skippedUnmapped = 0;
    let scanned = 0;
    let truncated = false;
    const remoteIds = collectRemoteIds ? new Set() : null;
    let page = 1;
    for (;;) {
        const url = new URL(`${base}${path}`);
        for (const [k, v] of Object.entries({ ...params, page, per_page: PER_PAGE })) url.searchParams.set(k, String(v));
        const { res, aborted: fetchAborted } = await fetchReconcilePage(url, auth);
        if (fetchAborted) return { restored, skippedUnmapped, scanned, truncated: true, aborted: fetchAborted };
        const body = await res.json();
        const key = Object.keys(body).find((k) => Array.isArray(body[k]));
        const items = (key ? body[key] : []).filter((r) => r && r.id != null);
        scanned += items.length;
        if (remoteIds) for (const r of items) remoteIds.add(String(r.id));

        if (items.length) {
            // One small indexed probe per page: which of these do we already
            // hold? Org- AND source-scoped, because the pms id is only unique
            // within a tenant — an unscoped probe would see another tenant's row
            // and conclude we already have a record we do not.
            const ids = items.map((r) => String(r.id));
            const { data: existing, error } = await supabase_1.serviceClient
                .from(table)
                .select(idCol)
                .eq('organisation_id', orgId)
                .eq('source', 'dentally')
                .in(idCol, ids);
            if (error) return { restored, skippedUnmapped, scanned, truncated: true, aborted: 'db_read_error' };
            const have = new Set((existing ?? []).map((r) => String(r[idCol])));
            const wanted = items.filter((rec) => !have.has(String(rec.id)));
            // Resolve context only for what we are actually going to write — a
            // page where we already hold everything costs no extra query.
            const ctx = prepare && wanted.length ? await prepare(wanted) : null;
            const rows = [];
            for (const rec of wanted) {
                const row = buildRow(rec, ctx);
                if (!row) { skippedUnmapped++; continue; } // e.g. practice_id is NOT NULL
                rows.push(row);
            }
            if (rows.length) restored += await upsertChunked(table, rows, onConflict);
        }

        const totalPages = body.meta?.total_pages;
        const done = totalPages ? page >= totalPages : items.length < PER_PAGE;
        if (done) break;
        if (page >= maxPages) { truncated = true; break; }
        page++;
        await sleep(RATE_DELAY_MS);
    }
    return { restored, skippedUnmapped, scanned, truncated, ...(remoteIds ? { remoteIds } : {}) };
}

// Appointments. Windowed on appointment DATE via after/before — note Dentally
// ignores `before` (verified live: a before-only query returns the whole
// 263,926-row collection), so the window is effectively open-ended forward.
// That only ever makes the pull a SUPERSET of the window, which is harmless
// here: a restored row outside the window is still a row Dentally has.
export async function reconcileMissingAppointments(orgId, base, auth, { sinceISO, untilISO, maxPages = WINDOW_RECON_MAX_PAGES, allowed = null } = {}) {
    const siteMap = await loadSiteMap(orgId);
    const contactMap = await loadContactMap(orgId);
    const practitionerMap = await loadPractitionerMap(orgId);
    // Restore-only: buildRow drops an unmapped practice, so narrowing the
    // remote side here is a pure saving and can delete nothing.
    const { params: scope } = await reconcileScope(orgId, allowed);
    return reconcileMissingRecords(orgId, base, auth, {
        path: '/appointments',
        params: { after: sinceISO, before: untilISO, cancelled: true, ...scope },
        table: 'appointments',
        idCol: 'pms_external_id',
        onConflict: 'organisation_id,source,pms_external_id',
        buildRow: (a) => appointmentRow(orgId, a, siteMap, contactMap, practitionerMap),
        maxPages,
    });
}

// Payments. /payments filters on dated_on (a DATE) via dated_after/dated_before.
export async function reconcileMissingPayments(orgId, base, auth, { sinceISO, untilISO, maxPages = WINDOW_RECON_MAX_PAGES, allowed = null } = {}) {
    const siteMap = await loadSiteMap(orgId);
    const contactMap = await loadContactMap(orgId);
    const { params: scope } = await reconcileScope(orgId, allowed);
    return reconcileMissingRecords(orgId, base, auth, {
        path: '/payments',
        params: { dated_after: String(sinceISO).slice(0, 10), dated_before: String(untilISO).slice(0, 10), ...scope },
        table: 'payments',
        idCol: 'external_id',
        onConflict: 'organisation_id,source,external_id',
        buildRow: (p) => paymentRow(orgId, p, siteMap, contactMap),
        maxPages,
    });
}

// Invoices. NOT windowed: Dentally ignores every date filter on /invoices
// (verified live — dated_after/dated_before, dated_from/dated_to and
// filter[dated_from]/filter[dated_to] all return the identical full collection).
// Passing collectRemoteIds lets the caller reuse this single page-through for
// the delete prune too, instead of paging the whole collection twice a night.
export async function reconcileMissingInvoices(orgId, base, auth, { maxPages = INVOICE_RECON_MAX_PAGES, collectRemoteIds = false, allowed = null } = {}) {
    const siteMap = await loadSiteMap(orgId);
    const contactMap = await loadContactMap(orgId);
    // DANGEROUS COUPLING, handled deliberately: with collectRemoteIds the ids
    // gathered here are handed to reconcileDeletedInvoices as its authoritative
    // remote set. Narrowing this fetch therefore narrows that set too, so the
    // delete MUST be given the same `allowed` and scope its local side to
    // match. Scoping one and not the other deletes every invoice belonging to
    // the practices this fetch no longer asked for.
    const { params: scope } = await reconcileScope(orgId, allowed);
    return reconcileMissingRecords(orgId, base, auth, {
        path: '/invoices',
        params: scope,
        table: 'invoices',
        idCol: 'external_id',
        onConflict: 'organisation_id,source,external_id',
        buildRow: (inv) => invoiceRow(orgId, inv, siteMap, contactMap),
        maxPages,
        collectRemoteIds,
    });
}

// Invoice items — the per-treatment fee lines behind each invoice. Not windowed
// for the same reason as invoices (Dentally ignores the date filters), and each
// item needs its parent invoice's practice/contact/date, resolved a page at a
// time through the same loadInvoiceContext the webhook path uses.
export async function reconcileMissingInvoiceItems(orgId, base, auth, { maxPages = INVOICE_RECON_MAX_PAGES } = {}) {
    const practitionerMap = await loadPractitionerMap(orgId);
    return reconcileMissingRecords(orgId, base, auth, {
        path: '/invoice_items',
        table: 'invoice_items',
        idCol: 'pms_external_id',
        onConflict: 'organisation_id,source,pms_external_id',
        prepare: (items) => loadInvoiceContext(orgId, items.map((it) => it.invoice_id)),
        buildRow: (it, ctx) => invoiceItemRow(orgId, it, ctx ?? new Map(), practitionerMap),
        maxPages,
    });
}

// Pure decision step for the payment delete-reconciliation, mirroring
// selectStaleAppointmentIds. Payments key on `external_id`. Same fail-closed
// guards: never act on an empty remote set, never delete more than
// maxDeleteShare of the window (a remote-shape change must not wipe real money).
export function selectStalePaymentIds(ourRows, remoteIdSet, { maxDeleteShare = 0.5 } = {}) {
    const stale = (ourRows || []).filter((r) => r.external_id != null && !remoteIdSet.has(String(r.external_id)));
    if (!ourRows || ourRows.length === 0) return { ids: [], aborted: null };
    if (remoteIdSet.size === 0) return { ids: [], aborted: 'empty_remote' };
    if (stale.length > ourRows.length * maxDeleteShare) return { ids: [], aborted: 'safety_threshold' };
    return { ids: stale.map((r) => r.id), aborted: null };
}

// Window-scoped delete reconciliation for PAYMENTS. Dentally's List-payments feed
// (filtered by `dated_after`/`dated_before` on `dated_on`) never returns VOIDED or
// DELETED payments — they are simply gone — so our upsert-only sync keeps stale
// rows forever and Takings drifts ABOVE Dentally's own report (confirmed: a voided
// duplicate £687 + a voided £1,452 inflated one practice's month by £1,939). Pull
// the AUTHORITATIVE id set for a bounded payment-date window, then delete our
// dentally-sourced payment rows in that window whose id Dentally no longer returns.
//
// Safety (this deletes financial rows, so it is fail-closed) — mirrors the
// appointment reconcile: only source='dentally' rows inside [sinceISO, untilISO);
// remote pull padded ±1 day (remote set can only be a SUPERSET, never miss a row);
// ABORTS (deletes nothing) unless it FULLY paged the window — any page-cap hit,
// HTTP error, fetch error, or empty/ambiguous body is "unknown", never "deleted";
// the pure selectStalePaymentIds guard aborts on an empty remote set or an
// implausibly large delete share.
export async function reconcileDeletedPayments(orgId, base, auth, { sinceISO, untilISO, maxPages = MAX_PAGES, allowed = null } = {}) {
    const scope = await reconcileScope(orgId, allowed);
    if (!sinceISO || !untilISO) return { deleted: 0, aborted: 'no_window' };
    const pad = 86400000; // ±1 day, in ms
    // /payments filters on dated_on (a DATE) via dated_after/dated_before.
    const dated_after = new Date(Date.parse(sinceISO) - pad).toISOString().slice(0, 10);
    const dated_before = new Date(Date.parse(untilISO) + pad).toISOString().slice(0, 10);
    const params = { dated_after, dated_before };
    const remoteIds = new Set();
    let page = 1;
    let complete = false;
    for (;;) {
        const url = new URL(`${base}/payments`);
        for (const [k, v] of Object.entries({ ...params, ...scope.params, page, per_page: PER_PAGE })) url.searchParams.set(k, String(v));
        const { res, aborted: fetchAborted } = await fetchReconcilePage(url, auth);
        if (fetchAborted) return { deleted: 0, aborted: fetchAborted }; // partial -> never delete
        const body = await res.json();
        const key = Object.keys(body).find((k) => Array.isArray(body[k]));
        const items = key ? body[key] : [];
        for (const p of items) if (p?.id != null) remoteIds.add(String(p.id));
        const totalPages = body.meta?.total_pages;
        const done = totalPages ? page >= totalPages : items.length < PER_PAGE;
        if (done) { complete = true; break; }
        if (page >= maxPages) break; // window too big to fully page -> abort below
        page++;
        await sleep(RATE_DELAY_MS);
    }
    if (!complete) return { deleted: 0, aborted: 'page_cap' };
    // Our dentally payments in the SAME (unpadded) window, by processed_at (= dated_on).
    const ourRows = [];
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
        let q = supabase_1.serviceClient
            .from('payments')
            .select('id, external_id')
            .eq('organisation_id', orgId)
            .eq('source', 'dentally')
            .gte('processed_at', sinceISO)
            .lt('processed_at', untilISO)
            .not('external_id', 'is', null);
        // Narrowed with the remote fetch above, never independently.
        if (scope.practiceIds) q = q.in('practice_id', scope.practiceIds);
        const { data, error } = await q.range(from, from + PAGE - 1);
        if (error) return { deleted: 0, aborted: 'db_read_error' };
        const rows = data ?? [];
        ourRows.push(...rows);
        if (rows.length < PAGE) break;
    }
    const { ids: staleIds, aborted } = selectStalePaymentIds(ourRows, remoteIds);
    if (aborted) return { deleted: 0, aborted, remote: remoteIds.size, scanned: ourRows.length };
    let deleted = 0;
    for (let i = 0; i < staleIds.length; i += 500) {
        const chunk = staleIds.slice(i, i + 500);
        const { error } = await supabase_1.serviceClient.from('payments').delete().in('id', chunk);
        if (!error) deleted += chunk.length;
    }
    return { deleted, remote: remoteIds.size, scanned: ourRows.length };
}

// Pure decision step for the invoice delete-reconciliation, mirroring
// selectStalePaymentIds. Invoices key on `external_id`. Returns the external
// ids alongside our row ids because invoice_items reference the DENTALLY
// invoice id (pms_invoice_id), not our row id, so the fee-line cascade cannot
// be done from `ids` alone. Same fail-closed guards: never act on an empty
// remote set, never delete more than maxDeleteShare of the collection.
export function selectStaleInvoiceIds(ourRows, remoteIdSet, { maxDeleteShare = 0.5 } = {}) {
    const stale = (ourRows || []).filter((r) => r.external_id != null && !remoteIdSet.has(String(r.external_id)));
    if (!ourRows || ourRows.length === 0) return { ids: [], externalIds: [], aborted: null };
    if (remoteIdSet.size === 0) return { ids: [], externalIds: [], aborted: 'empty_remote' };
    if (stale.length > ourRows.length * maxDeleteShare) return { ids: [], externalIds: [], aborted: 'safety_threshold' };
    return { ids: stale.map((r) => r.id), externalIds: stale.map((r) => String(r.external_id)), aborted: null };
}

// Whole-collection delete reconciliation for invoices.
//
// WHY IT IS NOT WINDOWED like its two siblings above: Dentally's /invoices
// endpoint SILENTLY IGNORES every date filter. Verified against the live API —
// dated_after/dated_before, dated_from/dated_to and filter[dated_from]/
// filter[dated_to] each return the identical full collection; only `site_id`
// narrows it. A windowed prune here would therefore be a windowed LOCAL read
// compared against a FULL remote set, which is merely wasteful today, but the
// day Dentally starts honouring those filters it inverts into a full local read
// against a windowed remote set — i.e. "delete every invoice outside the
// window". Both sides are read at the same (full) scope so the comparison can
// never drift into that. The extra cost is one full page-through per nightly
// sync (~240 pages at 23.7k invoices), and the payoff is that it also reaches
// deletions older than any rolling window would: of the 150 stale invoices
// found on the live project, 130 predated a 35-day window.
//
// Safety (this function deletes financial rows, so it is fail-closed):
//   - only ever touches rows with source='dentally' in this organisation;
//   - ABORTS (deletes nothing) on any page-cap hit, HTTP error, fetch error or
//     ambiguous body — an incomplete remote set makes every unseen invoice look
//     deleted, which is exactly the failure that would wipe real money;
//   - the pure selectStaleInvoiceIds guard aborts on an empty remote set or an
//     implausibly large delete share.
// Fee lines are deleted BEFORE their invoice: invoice_items are found by the
// Dentally invoice id, so removing the invoice first would strand them.
export async function reconcileDeletedInvoices(orgId, base, auth, { maxPages = INVOICE_RECON_MAX_PAGES, remoteIds: suppliedIds, allowed = null } = {}) {
    // `suppliedIds` normally comes from reconcileMissingInvoices, which is
    // given the SAME `allowed` — so a scoped remote set is compared against a
    // scoped local one. Passing one without the other is the bug this pairing
    // exists to prevent.
    const scope = await reconcileScope(orgId, allowed);
    // The backfill reconciler already walks this exact collection, so it can hand
    // its id set over rather than make us pay for a second ~240-page pass. It
    // passes null when ITS own pull was truncated or errored — a partial set must
    // never be mistaken for an authoritative one, which is the whole reason this
    // function is fail-closed.
    const remoteIds = suppliedIds instanceof Set ? suppliedIds : new Set();
    let page = 1;
    let complete = suppliedIds instanceof Set;
    for (; !complete;) {
        const url = new URL(`${base}/invoices`);
        for (const [k, v] of Object.entries(scope.params)) url.searchParams.set(k, String(v));
        url.searchParams.set('page', String(page));
        url.searchParams.set('per_page', String(PER_PAGE));
        const { res, aborted: fetchAborted } = await fetchReconcilePage(url, auth);
        if (fetchAborted) return { deleted: 0, aborted: fetchAborted }; // partial -> never delete
        const body = await res.json();
        const key = Object.keys(body).find((k) => Array.isArray(body[k]));
        const items = key ? body[key] : [];
        for (const inv of items) if (inv?.id != null) remoteIds.add(String(inv.id));
        const totalPages = body.meta?.total_pages;
        const done = totalPages ? page >= totalPages : items.length < PER_PAGE;
        if (done) { complete = true; break; }
        if (page >= maxPages) break; // collection too big to fully page -> abort below
        page++;
        await sleep(RATE_DELAY_MS);
    }
    if (!complete) return { deleted: 0, aborted: 'page_cap' };

    // Our dentally invoices, ALL of them — same scope as the remote set above.
    // Keyset-paged on external_id (unique within org+source, and the third
    // column of the upsert's conflict target) rather than .range(): OFFSET makes
    // the server re-walk every skipped row, which is quadratic in table size.
    const ourRows = [];
    let cursor = null;
    for (;;) {
        let q = supabase_1.serviceClient
            .from('invoices')
            .select('id, external_id')
            .eq('organisation_id', orgId)
            .eq('source', 'dentally')
            .not('external_id', 'is', null)
            .order('external_id', { ascending: true })
            .limit(1000);
        if (scope.practiceIds) q = q.in('practice_id', scope.practiceIds);
        if (cursor != null) q = q.gt('external_id', cursor);
        const { data, error } = await q;
        if (error) return { deleted: 0, aborted: 'db_read_error' };
        const rows = data ?? [];
        if (!rows.length) break;
        ourRows.push(...rows);
        cursor = rows[rows.length - 1].external_id;
        if (rows.length < 1000) break;
    }

    const { ids: staleIds, externalIds, aborted } = selectStaleInvoiceIds(ourRows, remoteIds);
    if (aborted) return { deleted: 0, aborted, remote: remoteIds.size, scanned: ourRows.length };
    if (!staleIds.length) return { deleted: 0, invoicesCleared: 0, remote: remoteIds.size, scanned: ourRows.length };

    // Counts INVOICES whose fee lines were cleared, not fee lines — a PostgREST
    // delete does not report how many rows it removed, and reporting a chunk
    // length as a row count would overstate or understate it every time.
    let invoicesCleared = 0;
    for (let i = 0; i < externalIds.length; i += 500) {
        const chunk = externalIds.slice(i, i + 500);
        const { error } = await supabase_1.serviceClient
            .from('invoice_items').delete()
            .eq('organisation_id', orgId).eq('source', 'dentally')
            .in('pms_invoice_id', chunk);
        if (!error) invoicesCleared += chunk.length;
    }
    let deleted = 0;
    for (let i = 0; i < staleIds.length; i += 500) {
        const chunk = staleIds.slice(i, i + 500);
        const { error } = await supabase_1.serviceClient
            .from('invoices').delete()
            .eq('organisation_id', orgId)
            .in('id', chunk);
        if (!error) deleted += chunk.length;
    }
    return { deleted, invoicesCleared, remote: remoteIds.size, scanned: ourRows.length };
}

// ============================================================================
// Historical payment-status repair.
//
// WHY. mapPaymentStatus once sent Dentally's `unexplained` /
// `partially_explained` states to 'pending'. They are money RECEIVED but not
// yet allocated to an invoice line, so the correct mapping is 'settled' — the
// code above now does that. The MAPPER was fixed; the ROWS it had already
// written never were, because the nightly sync pulls a rolling recent window
// and never revisits old dates.
//
// The result is a silent, permanent understatement of Takings for any window
// covering the affected period. Live today on BOTH orgs on this instance:
//   Plan4growth  5,418 rows / £830,468  (all dated <= 2024-10-01)
//   developer    5,422 rows / £843,310
// with 2,713 of Plan4growth's being CARD or CASH payments — money handed over
// at the desk, which is never "pending". Anyone reconciling those years
// against Dentally would find us low and have no way to see why.
//
// HOW. Re-pull the window from Dentally and upsert on
// (organisation_id, source, external_id) — the same key the nightly sync uses.
// Every row is re-derived through the CURRENT mapper from the authoritative
// remote record, so nothing is inferred or guessed from what we already hold.
// A row Dentally still reports as genuinely unpaid stays pending, correctly.
//
// Idempotent: re-running it re-derives the same values. Read-then-upsert only —
// it never deletes (reconcileDeletedPayments owns that, deliberately separate).
// ============================================================================
export async function repairPaymentStatuses(orgId, integration, { since, until, maxPages = MAX_PAGES } = {}) {
    const base = integration?.config?.base_url ?? DEFAULT_BASE;
    const auth = await resolveDentallyAuth(orgId, integration);
    if (!auth) return { error: 'no_auth' };
    if (!since || !until) return { error: 'no_window' };

    // Status mix BEFORE, so the caller can report what actually changed rather
    // than claiming success on a no-op.
    const before = await countPaymentStatuses(orgId, since, until);

    const siteMap = await loadSiteMap(orgId);
    const contactMap = await loadContactMap(orgId);
    // /payments filters on dated_on (a DATE) via dated_after/dated_before.
    const params = {
        dated_after: String(since).slice(0, 10),
        dated_before: String(until).slice(0, 10),
    };
    const { synced, skipped } = await pullPayments(
        orgId, base, auth, params, siteMap, contactMap, null, maxPages,
    );
    const after = await countPaymentStatuses(orgId, since, until);
    return {
        window: params,
        synced,
        skipped,
        before,
        after,
        // The number this repair exists to move.
        pendingCleared: Math.max(0, (before.pending || 0) - (after.pending || 0)),
        pencePendingCleared: Math.max(0, (before.pendingPence || 0) - (after.pendingPence || 0)),
    };
}

// Status mix for dentally-sourced payments in a window. Paged — a wide repair
// window can hold far more than the 1000-row read cap, and a capped count would
// misreport how much the repair moved.
export async function countPaymentStatuses(orgId, sinceISO, untilISO) {
    const out = { settled: 0, pending: 0, other: 0, pendingPence: 0 };
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase_1.serviceClient
            .from('payments')
            .select('status, amount_pence')
            .eq('organisation_id', orgId)
            .eq('source', 'dentally')
            .gte('processed_at', sinceISO)
            .lte('processed_at', untilISO)
            .range(from, from + PAGE - 1);
        if (error) return out;
        const rows = data ?? [];
        for (const r of rows) {
            if (r.status === 'settled') out.settled++;
            else if (r.status === 'pending') {
                out.pending++;
                out.pendingPence += r.amount_pence || 0;
            } else out.other++;
        }
        if (rows.length < PAGE) break;
    }
    return out;
}

async function pullPayments(orgId, base, auth, params, siteMap, contactMap, onPage, maxPages) {
    let synced = 0;
    let skipped = 0;
    await streamPages(orgId, base, '/payments', auth, params, async (items) => {
        const rows = [];
        for (const p of items) {
            const row = paymentRow(orgId, p, siteMap, contactMap);
            if (!row) { skipped++; continue; } // payments.practice_id is NOT NULL
            rows.push(row);
        }
        synced += await upsertChunked('payments', rows, 'organisation_id,source,external_id');
    }, onPage, maxPages);
    return { synced, skipped };
}

async function pullTreatmentPlans(orgId, base, auth, params, associateMap, contactMap, onPage, maxPages, practiceByPractitioner = new Map(), allowed = null, practiceByContact = new Map()) {
    let synced = 0;
    const strict = dropsUnattributed(allowed);
    await streamPages(orgId, base, '/treatment_plans', auth, params, async (items) => {
        const rows = items
            .filter((tp) => tp && tp.id != null)
            .map((tp) => treatmentPlanRow(orgId, tp, associateMap, contactMap, practiceByPractitioner, practiceByContact))
            .filter((r) => !strict || r?.practice_id);
        synced += await upsertChunked('treatment_plans', rows, 'organisation_id,source,pms_external_id');
    }, onPage, maxPages);
    return { synced };
}

// Pull /treatment_plan_items (the Practitioner Activity feed). Only `updated_after`
// is honoured server-side — the `completed`/date/site filters are silently ignored
// (the whole collection comes back regardless), so we filter to completed rows here
// and let the rollup RPC apply the completed_at window + base_chart exclusion. We
// persist only COMPLETED items: a planned-but-not-done item is irrelevant to this
// metric and would bloat the table (the full collection is ~725k rows); when an
// item is later completed its updated_at bumps and the incremental cursor re-pulls
// it. Never fail the whole sync if this resource errors (caller wraps in try).
async function pullTreatmentItems(orgId, base, auth, params, practiceByPractitioner, associateMap, contactMap, onPage, maxPages, allowed = null, practiceByContact = new Map()) {
    let synced = 0;
    const strict = dropsUnattributed(allowed);
    await streamPages(orgId, base, '/treatment_plan_items', auth, params, async (items) => {
        const rows = items
            .filter((it) => it && it.id != null && it.completed === true)
            .map((it) => treatmentItemRow(orgId, it, practiceByPractitioner, associateMap, contactMap, practiceByContact))
            .filter((r) => !strict || r?.practice_id);
        if (rows.length) synced += await upsertChunked('dentally_treatment_items', rows, 'organisation_id,source,pms_external_id');
    }, onPage, maxPages);
    return { synced };
}

async function pullInvoiceItems(orgId, base, auth, params, invoiceMap, practitionerMap, onPage, maxPages, allowed = null) {
    let synced = 0;
    const strict = dropsUnattributed(allowed);
    await streamPages(orgId, base, '/invoice_items', auth, params, async (items) => {
        const rows = items
            .filter((it) => it && it.id != null)
            .map((it) => invoiceItemRow(orgId, it, invoiceMap, practitionerMap))
            .filter((r) => !strict || r?.practice_id);
        synced += await upsertChunked('invoice_items', rows, 'organisation_id,source,pms_external_id');
    }, onPage, maxPages);
    return { synced };
}

async function pullInvoices(orgId, base, auth, params, siteMap, contactMap, onPage, maxPages) {
    let synced = 0;
    let skipped = 0;
    // Build the transient invoice map across pages — invoice_items carry only
    // invoice_id, so they resolve practice/contact/date through this map. Saves a
    // second full /invoices pull (the old buildInvoiceMap path). The map holds 4
    // small fields per invoice (not the full row), so it stays bounded even as
    // the invoice rows themselves stream out per page.
    const invoiceMap = new Map();
    await streamPages(orgId, base, '/invoices', auth, params, async (items) => {
        const rows = [];
        for (const inv of items) {
            if (inv && inv.id != null) {
                invoiceMap.set(String(inv.id), {
                    practice_id: siteMap.get(String(inv.site_id)) ?? null,
                    contact_id: contactMap.get(String(inv.patient_id)) ?? null,
                    dated_on: inv.dated_on ?? null,
                    paid: inv.paid === true,
                });
            }
            const row = invoiceRow(orgId, inv, siteMap, contactMap);
            if (!row) { skipped++; continue; } // invoices.practice_id is NOT NULL
            rows.push(row);
        }
        synced += await upsertChunked('invoices', rows, 'organisation_id,source,external_id');
    }, onPage, maxPages);
    return { synced, skipped, invoiceMap };
}

// ---- webhook apply (real-time, single record) -------------------------------
// Map+upsert ONE record pushed by a Dentally webhook, reusing the row builders
// above. resourceType ∈ patient|appointment|payment|invoice|invoice_item|
// treatment_plan. create/update both upsert (idempotent). invoice events also
// persist any embedded line items; standalone invoice_item events resolve their
// parent context from the invoices table. Returns a small result for logging.
// Field/event shapes are the documented v1 assumptions — verify against the live
// webhook during UAT.
// Build { dentally invoice id -> { practice_id, contact_id, dated_on, paid } }
// from the invoices already stored in our table, so a webhook invoice_item
// (which carries only invoice_id) resolves the practice/contact/date/paid it
// needs — the same 4 fields the poll's transient invoiceMap supplies. An invoice
// we have not stored yet simply maps to nothing; the item still upserts and the
// parent context backfills when the next poll links it (propagate_invoice_paid).
async function loadInvoiceContext(orgId, invoiceIds) {
    const ids = [...new Set((invoiceIds ?? []).filter((v) => v != null).map(String))];
    const map = new Map();
    if (!ids.length) return map;
    const { data } = await supabase_1.serviceClient
        .from('invoices')
        .select('external_id, practice_id, contact_id, dated_on, paid')
        .eq('organisation_id', orgId)
        .eq('source', 'dentally')
        .in('external_id', ids);
    for (const inv of data ?? []) {
        map.set(String(inv.external_id), {
            practice_id: inv.practice_id ?? null,
            contact_id: inv.contact_id ?? null,
            dated_on: inv.dated_on ?? null,
            paid: inv.paid ?? null,
        });
    }
    return map;
}

// Targeted relink: attach THIS just-upserted patient's contact to any of its own
// appointments left orphaned (contact_id null) by out-of-order webhook delivery —
// the appointment landing before its patient. Scoped to the single patient (one
// indexed UPDATE on pms_patient_id), so a patient-import burst costs one cheap
// statement per event, NOT a full-table relink every time. The `is null` guard
// touches only genuine orphans. The poll's org-wide
// relink_dentally_appointment_contacts stays the backstop for anything missed.
async function relinkPatientAppointments(orgId, pmsPatientId) {
    if (pmsPatientId == null) return;
    const pid = String(pmsPatientId);
    try {
        const { data: contact } = await supabase_1.serviceClient
            .from('contacts')
            .select('id')
            .eq('organisation_id', orgId)
            .eq('source', 'dentally')
            .eq('pms_external_id', pid)
            .maybeSingle();
        if (!contact?.id) return;
        await supabase_1.serviceClient
            .from('appointments')
            .update({ contact_id: contact.id })
            .eq('organisation_id', orgId)
            .eq('source', 'dentally')
            .eq('pms_patient_id', pid)
            .is('contact_id', null);
    } catch (err) {
        console.warn(`[dentally] webhook patient relink skipped: ${err?.message || err}`);
    }
}

// ---- webhook health (read-only) ---------------------------------------------
// Classify the live state of OUR Dentally webhook so a disabled/failing/mismatched
// hook is VISIBLE in the owner UI instead of silently dead. Pure + unit-tested.
// We match the webhook by the org's token payload (base64url(orgId)) embedded in
// the URL, so it is robust to host/path changes and never matches another org.
export function classifyWebhook(webhooks, orgId) {
    const frag = Buffer.from(String(orgId)).toString('base64url');
    const ours = (Array.isArray(webhooks) ? webhooks : []).find(
        (w) => typeof w?.url === 'string' && w.url.includes('/webhooks/dentally/') && w.url.includes(frag)
    );
    if (!ours) return { registered: false, status: 'unregistered' };
    const failed = Number(ours.failed_deliveries || 0);
    const ok = Number(ours.successful_deliveries || 0);
    let status;
    if (!ours.active) status = 'disabled';            // Dentally auto-disables after repeated failures
    else if (ok > 0) status = 'delivering';            // proven working
    else if (failed > 0) status = 'failing';           // active but nothing lands → secret mismatch / 4xx
    else status = 'idle';                              // active, no events yet
    return {
        registered: true,
        status,
        id: ours.id ?? null,
        active: !!ours.active,
        events: ours.events ?? null,
        failedDeliveries: failed,
        successfulDeliveries: ok,
        lastDeliveredAt: ours.last_delivered_at ?? null,
    };
}

// Best-effort live status of the org's Dentally webhook. Never throws — returns
// { available:false, reason } when the key cannot read webhooks (e.g. a
// read-restricted API key returns 403) so the UI degrades to the stored-secret hint.
export async function getWebhookHealth(orgId, integration = null) {
    try {
        const integ = integration || (await integrationRepository.getByProvider(orgId, 'dentally'));
        if (!integ || integ.status === 'revoked') return { available: false, reason: 'not_connected' };
        const auth = await resolveDentallyAuth(orgId, integ);
        if (!auth) return { available: false, reason: 'no_credentials' };
        const base = integ.config?.base_url ?? DEFAULT_BASE;
        const res = await fetchWithTimeout(new URL(`${base}/webhooks`), {
            headers: { Authorization: auth, 'User-Agent': USER_AGENT, Accept: 'application/json' },
        });
        if (!res.ok) return { available: false, reason: `http_${res.status}` };
        const body = await res.json();
        const list = body.webhooks || body.data || body;
        return { available: true, ...classifyWebhook(list, orgId) };
    } catch (err) {
        return { available: false, reason: err?.message || 'error' };
    }
}

// Table + external-id column per resourceType (the upsert conflict key's id col),
// shared by the create/update path and the delete path.
const WEBHOOK_TABLE = {
    patient: ['contacts', 'pms_external_id'],
    appointment: ['appointments', 'pms_external_id'],
    payment: ['payments', 'external_id'],
    invoice: ['invoices', 'external_id'],
    invoice_item: ['invoice_items', 'pms_external_id'],
    treatment_plan: ['treatment_plans', 'pms_external_id'],
};

// Remove a record Dentally reports deleted, keyed by org+source+external id, so
// a `*.deleted` event does not get upserted back into existence.
async function deleteByExternal(table, orgId, idCol, externalId) {
    const { error } = await supabase_1.serviceClient
        .from(table)
        .delete()
        .eq('organisation_id', orgId)
        .eq('source', 'dentally')
        .eq(idCol, String(externalId));
    if (error) throw new Error(`${table} webhook delete: ${error.message}`);
}

// A record we cannot store must not vanish without a word. Both exits below are
// returns, not throws, so the caller's try/catch never sees them and nothing is
// persisted — a whole resource type can stop arriving and look identical to one
// that was never sent. Measured cost of that blindness: this org has "All
// events" subscribed at Dentally, 38 appointment rows updated by webhook in a
// day and ZERO invoice rows touched, and the question "are invoice events being
// dropped or never sent?" could not be answered from anything we record.
function warnDropped(orgId, resourceType, reason, detail = {}) {
    console.warn('[dentally-webhook] record NOT stored', {
        orgId, resourceType, reason, ...detail,
    });
}

export async function applyWebhookEvent(orgId, resourceType, record, action = 'upsert') {
    if (!record || record.id == null) return { ignored: 'no_record_id' };
    if (action === 'delete') {
        const m = WEBHOOK_TABLE[resourceType];
        if (!m) {
            // A DELETE we ignore is not harmless: Dentally removed the record and
            // we keep ours, which is exactly how a voided invoice stays in the
            // totals forever.
            warnDropped(orgId, resourceType, 'unhandled_delete', { recordId: record?.id ?? null });
            return { ignored: resourceType };
        }
        await deleteByExternal(m[0], orgId, m[1], record.id);
        return { table: m[0], deleted: 1 };
    }
    const siteMap = await loadSiteMap(orgId);
    if (resourceType === 'patient') {
        await upsertChunked('contacts', [patientRow(orgId, record, siteMap)], 'organisation_id,source,pms_external_id');
        // A patient arriving after its appointments leaves those rows' contact_id
        // null; relink just this patient's orphans now rather than waiting for the
        // nightly poll (scoped — no full-table relink per event).
        await relinkPatientAppointments(orgId, record.id);
        return { table: 'contacts', applied: 1 };
    }
    // One event, one patient — not the whole org's contact table (see
    // contactMapFor). invoice_item carries no patient_id and resolves its
    // context from the parent invoice, so it issues no contact query at all.
    const contactMap = await contactMapFor(orgId, [record.patient_id]);
    if (resourceType === 'appointment') {
        const practitionerMap = await loadPractitionerMap(orgId);
        const row = appointmentRow(orgId, record, siteMap, contactMap, practitionerMap);
        if (!row) return { skipped: 'unmatched_practice' };
        await upsertChunked('appointments', [row], 'organisation_id,source,pms_external_id');
        return { table: 'appointments', applied: 1 };
    }
    if (resourceType === 'payment') {
        const row = paymentRow(orgId, record, siteMap, contactMap);
        if (!row) {
            warnDropped(orgId, 'payment', 'unmatched_practice', { siteId: record?.site_id ?? null, recordId: record?.id ?? null });
            return { skipped: 'unmatched_practice' };
        }
        await upsertChunked('payments', [row], 'organisation_id,source,external_id');
        return { table: 'payments', applied: 1 };
    }
    if (resourceType === 'invoice') {
        const row = invoiceRow(orgId, record, siteMap, contactMap);
        if (!row) {
            warnDropped(orgId, 'invoice', 'unmatched_practice', { siteId: record?.site_id ?? null, recordId: record?.id ?? null });
            return { skipped: 'unmatched_practice' };
        }
        await upsertChunked('invoices', [row], 'organisation_id,source,external_id');
        // Dentally invoice payloads usually embed their line items. Persist them
        // inline (the REAL per-treatment fees) so production data does not depend
        // on a separate invoice_item delivery; the parent context is THIS record,
        // so no lookup is needed. Items carrying no own invoice_id inherit it.
        const items = Array.isArray(record.invoice_items) ? record.invoice_items : [];
        let itemsApplied = 0;
        if (items.length) {
            const practitionerMap = await loadPractitionerMap(orgId);
            const invCtx = new Map([[String(record.id), {
                practice_id: siteMap.get(String(record.site_id)) ?? null,
                contact_id: contactMap.get(String(record.patient_id)) ?? null,
                dated_on: record.dated_on ?? null,
                paid: record.paid === true,
            }]]);
            const rows = items
                .filter((it) => it && it.id != null)
                .map((it) => invoiceItemRow(orgId, { ...it, invoice_id: it.invoice_id ?? record.id }, invCtx, practitionerMap));
            itemsApplied = await upsertChunked('invoice_items', rows, 'organisation_id,source,pms_external_id');
        }
        return { table: 'invoices', applied: 1, invoice_items: itemsApplied };
    }
    if (resourceType === 'invoice_item') {
        // Standalone item event: only invoice_id is present, so resolve the
        // practice/contact/date/paid from the parent invoice in our table.
        const invCtx = await loadInvoiceContext(orgId, [record.invoice_id]);
        const practitionerMap = await loadPractitionerMap(orgId);
        const row = invoiceItemRow(orgId, record, invCtx, practitionerMap);
        await upsertChunked('invoice_items', [row], 'organisation_id,source,pms_external_id');
        return { table: 'invoice_items', applied: 1 };
    }
    if (resourceType === 'treatment_plan') {
        // Associate production (the figure the Pay Run needs). associateMap is the
        // practitioner->associate map; contactMap resolves the patient.
        const associateMap = await loadPractitionerMap(orgId);
        const practiceByPractitioner = await loadPractitionerPracticeMap(orgId);
        const row = treatmentPlanRow(orgId, record, associateMap, contactMap, practiceByPractitioner);
        await upsertChunked('treatment_plans', [row], 'organisation_id,source,pms_external_id');
        return { table: 'treatment_plans', applied: 1 };
    }
    warnDropped(orgId, resourceType, 'unhandled_resource_type', { recordId: record?.id ?? null });
    return { ignored: resourceType };
}

// ---- orchestration ----------------------------------------------------------

export async function syncOneOrg(orgId, integration, onProgress = () => {}, { full = false, recent = false, resources = null } = {}) {
    // Resource selection — scope the pull to specific collections so a user who
    // only needs, say, patients isn't forced to wait out the heavy payments +
    // invoices phases (pure waste for their case). `resources` is an array of
    // keys (patients|appointments|payments|treatment_plans|invoices); null/empty
    // = pull everything (the default). `invoices` implies invoice_items — they're
    // pulled together and resolve through the same in-run invoice map.
    const selective = Array.isArray(resources) && resources.length > 0;
    const want = (k) => !selective || resources.includes(k);
    const base = integration.config?.base_url ?? DEFAULT_BASE;
    const auth = await resolveDentallyAuth(orgId, integration);
    if (!auth) {
        await integrationRepository.markFailed(orgId, 'dentally', 'no_auth: missing or undecryptable API key');
        return { error: 'no_auth' };
    }
    // Sites this org pulls (null = all). A Dentally grant is group-wide, so
    // without this a sub-account reads every practice the token can see.
    const allowed = allowedSites(integration);
    // Patient -> practice, the fallback attribution for treatment rows. Only
    // built for a scoped org: it costs a paged read of contacts and changes no
    // answer for an org that holds every practice.
    const practiceByContact = dropsUnattributed(allowed)
        ? await loadContactPracticeMap(orgId).catch(() => new Map())
        : new Map();
    // Window selection — ONE window, shared by patients / appointments /
    // payments (all filtered by `updated_after`):
    //  - full   : the most-recent 6 months (backfillSince()) with a lifted page cap.
    //  - recent : the on-connect bootstrap — last RECENT_MONTHS (1 year). A
    //             fresh org lands a complete, bounded 1-year dataset including
    //             COMPLETED appointments, so Associates / Treatment Mix / Pay
    //             have recent historical rows immediately. The deeper history is
    //             pulled overnight by the nightly cron's one-time full backfill.
    //  - else   : incremental cursor — changed-since last successful sync
    //             (default 30d on first run).
    const since = full
        ? backfillSince()
        : recent
            ? new Date(Date.now() - RECENT_MONTHS * 30 * 86400000).toISOString()
            : (integration.last_sync_at ?? new Date(Date.now() - 30 * 86400000).toISOString());
    const maxPages = full ? BACKFILL_MAX_PAGES : recent ? BOOTSTRAP_MAX_PAGES : MAX_PAGES;

    // Resume checkpoint — only the full backfill (the long, OOM-prone, restart-
    // exposed path). The process can die mid-pull (deploy, dyno recycle, OOM) and
    // last_sync_at only advances on full completion, so without this a restarted
    // full pull re-pulls the same 6-month window from page 1 every time. We record
    // which heavy phases finished, keyed by the backfill window (day-bucketed:
    // backfillSince() shifts each ms, so an exact-timestamp key would never match
    // a later run; the window only moves a day at a time). A re-run for the same
    // day skips finished phases; already-upserted rows are idempotent regardless.
    // Resume only the unscoped full backfill (the long, OOM-prone path). A
    // selective run is short and the user explicitly asked for those resources,
    // so honour the pick every time rather than skipping a phase a prior run
    // happened to finish.
    // `recent` (the on-connect bootstrap) resumes for the same reason `full`
    // does, and more urgently: it is the FIRST pull, so a restart mid-run leaves
    // the tenant with a partial dataset and nothing recorded to say so. Observed
    // live — a deploy killed a bootstrap at 4,060 patients / 14,463 appointments
    // with payments, invoices and treatment plans never reached, and no error.
    // A selective run still never resumes: the user picked those resources, so
    // honour the pick rather than skipping a phase an earlier run finished.
    const resumeMode = (full || recent) && !selective;
    const windowKey = since.slice(0, 10);
    const prevCursor = integration.config?.dentally_sync_cursor;
    const completedPhases = (resumeMode && prevCursor && prevCursor.window === windowKey)
        ? new Set(prevCursor.done ?? [])
        : new Set();
    const markPhaseDone = async (phaseKey) => {
        if (!resumeMode) return;
        completedPhases.add(phaseKey);
        try {
            await integrationRepository.mergeConfig(orgId, 'dentally', {
                dentally_sync_cursor: { window: windowKey, done: [...completedPhases] },
            });
        } catch (err) {
            console.warn(`[dentally] checkpoint write skipped: ${err?.message || err}`);
        }
    };

    // All three resources pull the same `updated_after` window. The earlier
    // bootstrap fetched upcoming-only appointments (`after=now`) + all-history
    // patients for a fast first paint, but that left every completed appointment
    // — and therefore associate_id / appointment_type / production analytics —
    // empty. A bounded historical pull is the deliberate trade: a few
    // more pages on connect for a dataset every module can actually use.
    // `cancelled: true` is REQUIRED — Dentally's GET /appointments defaults to
    // cancelled=false, which silently drops BOTH cancelled AND did_not_attend
    // (DNA) appointments. Without it we never store a single no_show row (so the
    // no-show rate shows "—, not tracked") and our appointment totals understate
    // Dentally's "found" count by the cancelled volume (~19% at a busy site).
    // mapAppointmentStatus already maps cancelled -> 'cancelled' and DNA ->
    // 'no_show'; this just stops the API from withholding those rows.
    // Ask Dentally for only the practices this organisation pulls.
    const siteParams = siteRequestParams(allowed);
    const apptParams = { updated_after: since, cancelled: true, ...siteParams };
    const patientParams = { updated_after: since, ...siteParams };
    // /payments has NO `updated_after` — Dentally's List-payments endpoint only
    // filters by payment date (`dated_after`/`dated_before` on `dated_on`). An
    // unknown param is silently ignored and the WHOLE history comes back every
    // sync (the runaway "1800 payments and climbing" re-pull). `dated_after`
    // takes a date, so window to the day; same-day rows re-pull harmlessly
    // (upsert dedups on org+source+external_id). Trade-off: a back-dated edit to
    // an OLD payment won't surface incrementally (its `dated_on` predates the
    // window) — the periodic full backfill (dated_after = 2y ago) reconciles those.
    const payParams = { dated_after: since.slice(0, 10), ...siteParams };
    const invoiceParams = { updated_after: since, ...siteParams };

    // Page-weighted progress. The 3 resources are very unequal (a practice can
    // have ~5x more appointments than patients), so weighting each phase as a
    // flat 1/3 made the bar pace wildly and the headline % disagree with the
    // visible "page X of Y". Instead probe total_pages for all 3 resources up
    // front (one cheap request each), sum to a grand total, and report overall
    // pct = cumulative-pages-done / grand-total. The number now matches reality
    // and moves smoothly. The page-1 probe rows are re-fetched by the pull (one
    // wasted page/resource — negligible against hundreds).
    // Weighted progress phases, in execution order. Every heavy pull is weighted
    // so the bar reflects ALL fetching — previously treatment_plans + invoice_items
    // (the largest pulls on a full backfill) ran silent between payments and
    // invoices, freezing the bar mid-sync; and the bar hit the 99 ceiling after
    // invoices while invoice_items + the relink RPCs still ran with no feedback.
    const PHASES = ['patients', 'appointments', 'payments', 'treatment_plans', 'invoices', 'invoice_items', 'treatment_items'];
    // Only probe (and below, only pull) the selected resources. An unselected
    // phase contributes 0 pages to the weighted total and is never fetched, so
    // the bar paces over exactly the work that runs.
    const probe = (k, path, params) => want(k) ? fetchPageCount(base, path, auth, params, maxPages) : Promise.resolve(0);
    const [patientPages, apptPages, payPages, planPages, invoicePages, itemPages, tiPages] = await Promise.all([
        probe('patients', '/patients', patientParams),
        probe('appointments', '/appointments', apptParams),
        probe('payments', '/payments', payParams),
        probe('treatment_plans', '/treatment_plans', { updated_after: since }),
        probe('invoices', '/invoices', invoiceParams),
        probe('invoices', '/invoice_items', { updated_after: since }),
        probe('treatment_items', '/treatment_plan_items', { updated_after: since }),
    ]);
    const phaseTotals = [patientPages, apptPages, payPages, planPages, invoicePages, itemPages, tiPages];
    const reporter = (idx) => (page, totalPages, count, kept) => {
        // reportPct grows phaseTotals from the live pull so an under-counting
        // probe (no meta.total_pages -> 1, or a timed-out probe -> 0) can't
        // freeze the bar at 0% for a whole phase. See reportPct's comment.
        // count = records fetched so far this phase, surfaced live in the UI.
        onProgress({ phase: PHASES[idx], pct: reportPct(phaseTotals, idx, page, totalPages), page, totalPages, count, kept });
    };

    try {
        // Pre-register the phases this run will walk, in execution order, so the
        // overlay lists every resource up front (as "Waiting") instead of
        // revealing each only as it starts. Mirror the run conditions below so an
        // unselected/skipped resource is never listed.
        const expectedPhases = [];
        if (want('appointments') || want('treatment_plans')) expectedPhases.push('practitioners');
        expectedPhases.push('staff');
        for (const p of PHASES) {
            if (p === 'invoice_items' ? want('invoices') : want(p)) expectedPhases.push(p);
        }
        if (want('patients') || want('appointments') || want('invoices')) expectedPhases.push('linking');
        onProgress({ expectedPhases });

        const siteMap = await loadSiteMap(orgId);
        // Opening hours: one unpaged request, so it runs on every sync rather
        // than only on connect. It feeds Chair Utilisation's capacity, and it
        // is wrapped because a failure here must never fail a clinical pull —
        // a stale opening hour is a smaller problem than a missing patient.
        try {
            await pullOpeningHours(orgId, base, auth, siteMap);
        } catch (err) {
            console.warn(`[dentally] opening-hours pull failed (non-fatal): ${err?.message || err}`);
        }
        // The practitioner rota: the denominator behind every utilisation
        // figure on the product. Wrapped for the same reason as opening hours,
        // and like it run on EVERY sync rather than only on connect, because
        // /rota_practitioner_diaries offers no updated_after — the window has
        // to be re-read rather than topped up.
        //
        // The first run for an org reaches back a year instead of six weeks,
        // and records that it did. Utilisation is reported over months that
        // have already closed, so an org whose rota only began yesterday would
        // show every past month as "no rota" — which on screen is
        // indistinguishable from a practice where nobody worked.
        try {
            const firstRota = !integration.config?.rota_backfilled_at;
            const rota = await pullRota(orgId, base, auth, siteMap,
                firstRota ? { since: rotaDay(-ROTA_BACKFILL_DAYS) } : {});
            // Only recorded when the deep pull came back CLEAN. A partial
            // backfill that stamped itself done would leave a permanent hole
            // no later run would ever go back for.
            if (firstRota && !rota.problems.length) {
                await integrationRepository.mergeConfig(orgId, 'dentally', {
                    rota_backfilled_at: new Date().toISOString(),
                    rota_backfilled_since: rota.since,
                });
            }
        } catch (err) {
            console.warn(`[dentally] rota pull failed (non-fatal): ${err?.message || err}`);
        }
        // Practitioners first (cheap, no separate progress phase) so the
        // appointment pull can resolve associate_id. ALWAYS pull the FULL roster
        // (no updated_after filter): the practitioner set is tiny (a handful of
        // pages for the whole practice), but treatment_plan_items + appointments
        // reference HISTORICAL practitioners whose record hasn't been "updated"
        // recently. Windowing by updated_after dropped those clinicians from the
        // roster, so their treatment items resolved practice_id = null — the
        // Practitioner Activity / "Treatments Completed" card then read 0 for an
        // individual practice and undercounted the group. (regression: an org
        // synced 17 of ~216 practitioners; 64/72 treating clinicians were absent.)
        // Practitioners + staff are small (whole-practice team), so they aren't
        // weighted, but we emit a phase label + live count so the overlay shows
        // "Practitioners · N pulled" instead of dead air at pct 0 before patients.
        let practitioners = { synced: 0 };
        // Practitioners resolve associate_id on appointments + treatment_plans;
        // skip the pull when neither is selected (e.g. a patients-only run).
        if (want('appointments') || want('treatment_plans')) {
            onProgress({ phase: 'practitioners', pct: 0, count: 0 });
            try {
                practitioners = await pullPractitioners(orgId, base, auth, { ...siteParams }, siteMap, maxPages, allowed);
                onProgress({ phase: 'practitioners', pct: 0, count: practitioners.synced });
            } catch (err) {
                console.warn(`[dentally] practitioners pull skipped: ${err?.message || err}`);
            }
        }
        const practitionerMap = await loadPractitionerMap(orgId);
        // Team roster from /users (cheap). Non-fatal: a failure here must not
        // abort the whole sync. Populates the Staff screen.
        onProgress({ phase: 'staff', pct: 0, count: 0 });
        let staff = { synced: 0 };
        try {
            staff = await pullUsers(orgId, base, auth, { ...siteParams }, siteMap, maxPages, allowed);
            onProgress({ phase: 'staff', pct: 0, count: staff.synced });
        } catch (err) {
            console.warn(`[dentally] users pull skipped: ${err?.message || err}`);
        }
        // Patients first so appointment/payment contact resolution sees fresh ids.
        // Each heavy phase is skipped if a prior run for this window already
        // finished it (resume after a mid-backfill restart); contactMap still
        // loads from the already-upserted contacts, so a skipped patients phase
        // doesn't strand appointment contact resolution.
        let patients = { synced: 0 };
        if (want('patients') && !completedPhases.has('patients')) {
            patients = await pullPatients(orgId, base, auth, patientParams, siteMap, reporter(0), maxPages, allowed);
            await markPhaseDone('patients');
        }
        const contactMap = await loadContactMap(orgId);
        // openOnly defaults false: store every appointment in the window
        // (completed history included), not just upcoming diary blocks.
        let appts = { synced: 0, skipped: 0, skippedClosed: 0 };
        if (want('appointments') && !completedPhases.has('appointments')) {
            appts = await pullAppointments(orgId, base, auth, apptParams, siteMap, contactMap, reporter(1), maxPages, { practitionerMap });
            await markPhaseDone('appointments');
        }
        // The historical `updated_after` pull above is ordered oldest-first and
        // can exhaust the page cap before reaching today — so future bookings
        // (exactly what the Appointments diary screen shows) may never land.
        // Pull the upcoming book explicitly: `after=now` is a small, separate
        // query that can't be crowded out by years of history, guaranteeing the
        // live diary populates. Upserts dedupe against the historical rows.
        // Only needed for the bootstrap (recent): full/incremental either lift
        // the cap (full) or ride the changed-since cursor (incremental), so they
        // already capture future bookings.
        let upcomingSynced = 0;
        if (recent && want('appointments')) {
            try {
                const upcoming = await pullAppointments(orgId, base, auth, { after: new Date().toISOString(), cancelled: true, ...siteParams }, siteMap, contactMap, null, maxPages, { practitionerMap });
                upcomingSynced = upcoming.synced ?? 0;
            } catch (err) {
                console.warn(`[dentally] upcoming appointments pull skipped: ${err?.message || err}`);
            }
        }
        // Delete-reconciliation: prune appointments Dentally has removed but our
        // upsert-only sync still holds (the source of count drift above Dentally —
        // see reconcileDeletedAppointments). Bounded to a recent ±35-day window so
        // it pages fully under the cap for one org; fail-closed (deletes nothing
        // unless it fully paged the window). Non-fatal: a prune failure must never
        // abort the sync. Skipped on the bootstrap (recent) pull, whose appointment
        // set is deliberately partial (open-only / page-capped history).
        // Every reconciler below is non-fatal and fails QUIETLY by design — a
        // prune that cannot page its window deletes nothing, a backfill that gets
        // a 500 restores nothing, and the sync reports success either way. That
        // is the right behaviour and, on its own, a terrible outcome: "reconciled
        // cleanly" and "never ran" look identical from outside, which is exactly
        // how the appointment prune aborted on 'page_cap' every night for months
        // with nobody the wiser. Record each pass so silence is distinguishable
        // from success.
        const reconcile = { at: new Date().toISOString() };
        const note = (key, r) => {
            reconcile[key] = {
                ...(r?.restored != null ? { restored: r.restored } : {}),
                ...(r?.deleted != null ? { deleted: r.deleted } : {}),
                ...(r?.skippedUnmapped ? { skippedUnmapped: r.skippedUnmapped } : {}),
                ...(r?.truncated ? { truncated: true } : {}),
                ...(r?.aborted ? { aborted: r.aborted } : {}),
            };
        };
        let pruned = { deleted: 0 };
        if (!recent && want('appointments')) {
            try {
                const wMs = 35 * 86400000;
                const reconSince = new Date(Date.now() - wMs).toISOString();
                const reconUntil = new Date(Date.now() + wMs).toISOString();
                pruned = await reconcileDeletedAppointments(orgId, base, auth, {
                    allowed,
                    sinceISO: reconSince,
                    untilISO: reconUntil,
                    // NOT `maxPages`. Dentally ignores `before` here, so this
                    // window pull actually returns everything from `after`
                    // onward including the whole future diary — 17,505 rows for
                    // this org against a 100-page (10,000-row) MAX_PAGES. The
                    // prune is fail-closed, so it was aborting on 'page_cap'
                    // every night and had never deleted anything.
                    maxPages: full ? maxPages : WINDOW_RECON_MAX_PAGES,
                });
                note('appointments_prune', pruned);
                if (pruned.aborted) {
                    console.warn(`[dentally] appointment prune aborted (${pruned.aborted}) — no rows deleted`);
                } else if (pruned.deleted) {
                    console.warn(`[dentally] appointment prune removed ${pruned.deleted} stale row(s) Dentally no longer has`);
                }
            } catch (err) {
                console.warn(`[dentally] appointment prune skipped: ${err?.message || err}`);
            }
        }
        let pays = { synced: 0, skipped: 0 };
        if (want('payments') && !completedPhases.has('payments')) {
            pays = await pullPayments(orgId, base, auth, payParams, siteMap, contactMap, reporter(2), maxPages);
            await markPhaseDone('payments');
        }
        // Delete-reconciliation for payments: prune rows Dentally has VOIDED/removed
        // but our upsert-only sync still holds — the source of Takings drift above
        // Dentally's own report (voided duplicates / reversed payments). Same recent
        // ±35-day window + fail-closed guards as the appointment prune. Non-fatal;
        // skipped on the partial bootstrap (recent) pull.
        if (!recent && want('payments')) {
            try {
                const wMs = 35 * 86400000;
                // Nightly/incremental: a recent ±35-day window (voids happen near the
                // payment date — cheap, one extra paged id-pull). The one-time full
                // backfill widens the scan back to the 6-month history so even an old
                // void clears once; nightly is unaffected. maxPages is already
                // BACKFILL_MAX_PAGES on the full path, so the wide window can page out.
                const reconSince = full ? backfillSince() : new Date(Date.now() - wMs).toISOString();
                const reconUntil = new Date(Date.now() + wMs).toISOString();
                const prunedPay = await reconcileDeletedPayments(orgId, base, auth, { sinceISO: reconSince, untilISO: reconUntil, maxPages, allowed });
                note('payments_prune', prunedPay);
                if (prunedPay.aborted) {
                    console.warn(`[dentally] payment prune aborted (${prunedPay.aborted}) — no rows deleted`);
                } else if (prunedPay.deleted) {
                    console.warn(`[dentally] payment prune removed ${prunedPay.deleted} stale row(s) Dentally no longer has`);
                }
            } catch (err) {
                console.warn(`[dentally] payment prune skipped: ${err?.message || err}`);
            }
        }
        // BACKFILL reconciliation — the other direction. The prunes above remove
        // what Dentally deleted; these restore what we never received. An
        // `updated_after` feed can only move forward, so without this a record
        // missed once is missed forever and the gap compounds month by month
        // (measured: 15 of Rochester's 620 August appointments absent, every one
        // still live in Dentally). Fail-open by design — see
        // reconcileMissingRecords. Skipped on the bootstrap (recent) pull, whose
        // dataset is deliberately partial; non-fatal like every reconciler here.
        if (!recent) {
            const wMs = 35 * 86400000;
            const backSince = full ? backfillSince() : new Date(Date.now() - wMs).toISOString();
            const backUntil = new Date(Date.now() + wMs).toISOString();
            if (want('appointments')) {
                try {
                    const b = await reconcileMissingAppointments(orgId, base, auth, { sinceISO: backSince, untilISO: backUntil, allowed });
                    note('appointments_backfill', b);
                    if (b.restored) console.warn(`[dentally] appointment backfill restored ${b.restored} row(s) the incremental feed had missed`);
                    if (b.skippedUnmapped) console.warn(`[dentally] appointment backfill skipped ${b.skippedUnmapped} row(s) with an unmapped site`);
                } catch (err) {
                    console.warn(`[dentally] appointment backfill skipped: ${err?.message || err}`);
                }
            }
            if (want('payments')) {
                try {
                    const b = await reconcileMissingPayments(orgId, base, auth, { sinceISO: backSince, untilISO: backUntil, allowed });
                    note('payments_backfill', b);
                    if (b.restored) console.warn(`[dentally] payment backfill restored ${b.restored} row(s) the incremental feed had missed`);
                } catch (err) {
                    console.warn(`[dentally] payment backfill skipped: ${err?.message || err}`);
                }
            }
        }
        // Treatment plans = production per practitioner (for the Associate Pay
        // Run). Same window as payments; reuse the practitioner + contact maps to
        // resolve associate_id / contact_id. Weighted phase 3; never fail the
        // whole sync if this resource errors.
        let treatmentPlans = { synced: 0 };
        if (want('treatment_plans') && !completedPhases.has('treatment_plans')) {
            try {
                const practiceByPractitioner = await loadPractitionerPracticeMap(orgId);
                treatmentPlans = await pullTreatmentPlans(orgId, base, auth, { updated_after: since }, practitionerMap, contactMap, reporter(3), maxPages, practiceByPractitioner, allowed, practiceByContact);
                await markPhaseDone('treatment_plans');
            } catch (err) {
                console.warn(`[dentally] treatment_plans pull skipped: ${err?.message || err}`);
            }
        }
        // Invoices (phase 4) are pulled once and persisted; the same fetch builds
        // the transient invoice map (practice/contact/date per invoice id) that
        // invoice_items needs to resolve each fee line — no second /invoices pull.
        // Invoices + invoice_items resume as a unit: invoice_items needs the
        // invoiceMap that the invoices pull builds, so we only skip the invoices
        // pull once invoice_items (the final data phase) is recorded done —
        // otherwise a resumed run would feed invoice_items an empty map and null
        // out every fee line's practice/date.
        const invoiceStageDone = completedPhases.has('invoice_items');
        let invoices = { synced: 0, skipped: 0, invoiceMap: new Map() };
        let invoiceItems = { synced: 0 };
        if (want('invoices') && !invoiceStageDone) {
            invoices = await pullInvoices(orgId, base, auth, invoiceParams, siteMap, contactMap, reporter(4), maxPages);
            // Invoice items = the real per-treatment fee feed (treatment name +
            // price), resolved against the invoice map. Weighted phase 5; same
            // never-fail-the-whole-sync pattern as plans.
            try {
                invoiceItems = await pullInvoiceItems(orgId, base, auth, { updated_after: since }, invoices.invoiceMap ?? new Map(), practitionerMap, reporter(5), maxPages, allowed);
            } catch (err) {
                console.warn(`[dentally] invoice_items pull skipped: ${err?.message || err}`);
            }
            await markPhaseDone('invoices');
            await markPhaseDone('invoice_items');
        }
        // Delete-reconciliation for invoices: prune invoices Dentally has REMOVED
        // but our upsert-only pull still holds. Unlike the appointment/payment
        // prunes above this is NOT windowed — Dentally ignores date filters on
        // /invoices, so both sides are read at full scope (see
        // reconcileDeletedInvoices for why a windowed version is unsafe here).
        // Skipped on the bootstrap (recent) pull, whose invoice set is
        // deliberately partial. Non-fatal: a prune failure must never abort the
        // sync, and the reconciler itself deletes nothing unless it fully paged.
        let prunedInv = { deleted: 0 };
        if (!recent && want('invoices')) {
            try {
                // ONE page-through of the whole collection serves both
                // directions: it restores invoices we never received and hands
                // its id set to the prune, so the 240-page walk happens once a
                // night rather than twice.
                const back = await reconcileMissingInvoices(orgId, base, auth, { collectRemoteIds: true, allowed });
                note('invoices_backfill', back);
                if (back.restored) console.warn(`[dentally] invoice backfill restored ${back.restored} row(s) the incremental feed had missed`);
                // Fee lines too, or the two tables drift apart: `invoices` would
                // carry a period that `invoice_items` has no lines for, and the
                // money cards built on each would stop reconciling.
                try {
                    const bi = await reconcileMissingInvoiceItems(orgId, base, auth);
                    note('invoice_items_backfill', bi);
                    if (bi.restored) console.warn(`[dentally] invoice_item backfill restored ${bi.restored} fee line(s)`);
                } catch (err) {
                    console.warn(`[dentally] invoice_item backfill skipped: ${err?.message || err}`);
                }
                prunedInv = await reconcileDeletedInvoices(orgId, base, auth, {
                    // Same `allowed` as the fetch that produced these ids —
                    // scoping one side alone deletes the other practices' rows.
                    allowed,
                    remoteIds: back.truncated || back.aborted ? null : back.remoteIds,
                });
                note('invoices_prune', prunedInv);
                if (prunedInv.aborted) {
                    console.warn(`[dentally] invoice prune aborted (${prunedInv.aborted}) — no rows deleted`);
                } else if (prunedInv.deleted) {
                    console.warn(`[dentally] invoice prune removed ${prunedInv.deleted} invoice(s) Dentally no longer has, clearing the fee lines of ${prunedInv.invoicesCleared ?? 0} of them`);
                }
            } catch (err) {
                console.warn(`[dentally] invoice prune skipped: ${err?.message || err}`);
            }
        }
        // Treatment plan ITEMS = the completed-treatment feed behind Dentally's
        // Practitioner Activity report (the "Treatments Completed" card). Weighted
        // phase 6; never fail the whole sync. Practice attribution via the
        // practitioner's home site (practiceByPractitioner); associate/contact via
        // the maps already built above.
        let treatmentItems = { synced: 0 };
        if (want('treatment_items') && !completedPhases.has('treatment_items')) {
            try {
                const practiceByPractitioner = await loadPractitionerPracticeMap(orgId);
                treatmentItems = await pullTreatmentItems(orgId, base, auth, { updated_after: since }, practiceByPractitioner, practitionerMap, contactMap, reporter(6), maxPages, allowed, practiceByContact);
                await markPhaseDone('treatment_items');
            } catch (err) {
                console.warn(`[dentally] treatment_items pull skipped: ${err?.message || err}`);
            }
        }
        // Self-heal practice attribution on the items feed. treatment_plan_items
        // carry only practitioner_id, so practice_id is resolved from the
        // practitioner's home site at pull time. Any item pulled BEFORE its
        // practitioner landed in the roster (incomplete-roster sync, or items
        // pulled ahead of a practitioner this run) is stranded with practice_id =
        // null and never re-corrected by an idempotent upsert. Re-stamp from the
        // now-complete org roster every sync: a cheap set-based UPDATE that fixes
        // those null/stale rows so the Treatments Completed card scopes per
        // practice. Non-fatal — the RPC is absent on un-migrated DBs.
        if (want('treatment_items')) {
            try {
                await supabase_1.serviceClient.rpc('restamp_treatment_item_practices', { p_org: orgId });
            } catch (err) {
                console.warn(`[dentally] treatment_items practice restamp skipped: ${err?.message || err}`);
            }
        }
        // Same self-heal for treatment PLANS (practice via practitioner home site).
        if (want('treatment_plans')) {
            try {
                await supabase_1.serviceClient.rpc('restamp_treatment_plan_practices', { p_org: orgId });
            } catch (err) {
                console.warn(`[dentally] treatment_plans practice restamp skipped: ${err?.message || err}`);
            }
        }
        // All pulls done; the relink RPCs below are set-based SQL that can take a
        // while on a large org (hundreds of thousands of appointments). Emit an
        // explicit "linking" phase at the 99 ceiling so the bar shows real work
        // instead of looking frozen at 99% while these run. Each relink touches
        // appointments, so only run the ones whose inputs were actually pulled —
        // a payments-only run has nothing to relink.
        const doRelinkContacts = want('patients') || want('appointments');
        const doRelinkAssociates = want('appointments');
        const doRepaid = want('invoices');
        if (doRelinkContacts || doRelinkAssociates || doRepaid) {
            onProgress({ phase: 'linking', pct: 99, count: 0 });
        }
        // Backfill contact_id for any appointment that has a Dentally patient id
        // but no linked contact yet (patient pulled in another run, or a row
        // from before this column existed). Set-based; cheap; never cross-tenant.
        let relinked = 0;
        if (doRelinkContacts) {
            try {
                const { data } = await supabase_1.serviceClient.rpc('relink_dentally_appointment_contacts', { p_org: orgId });
                relinked = typeof data === 'number' ? data : 0;
            } catch (err) {
                console.warn(`[dentally] relink contacts skipped: ${err?.message || err}`);
            }
        }
        // Same pattern for associate_id: appointments persist pms_practitioner_id,
        // so a practitioner pulled/mapped after the appointment was synced (or a
        // /practitioners pull that only succeeds on a later run) backfills
        // associate_id without a full appointment re-pull.
        let relinkedAssociates = 0;
        if (doRelinkAssociates) {
            try {
                const { data } = await supabase_1.serviceClient.rpc('relink_dentally_appointment_associates', { p_org: orgId });
                relinkedAssociates = typeof data === 'number' ? data : 0;
            } catch (err) {
                console.warn(`[dentally] relink associates skipped: ${err?.message || err}`);
            }
        }
        // Reconcile invoice_items.invoice_paid to the invoices table's current paid
        // status. Dentally bumps an invoice's updated_at when it's paid but NOT its
        // line-items', so an incremental sync re-pulls the (now-paid) invoice but
        // never the items — leaving invoice_paid stale and the Treatments Paid card
        // under-reporting. Set-based; cheap; org-scoped.
        let repaidItems = 0;
        if (doRepaid) {
            try {
                const { data } = await supabase_1.serviceClient.rpc('propagate_invoice_paid', { p_org: orgId });
                repaidItems = typeof data === 'number' ? data : 0;
            } catch (err) {
                console.warn(`[dentally] propagate invoice_paid skipped: ${err?.message || err}`);
            }
        }
        // The full pull completed — last_sync_at now covers the window, so the
        // resume checkpoint is spent. Clear it so the next full pull starts fresh
        // rather than skipping phases against a stale window.
        if (resumeMode) {
            try {
                await integrationRepository.mergeConfig(orgId, 'dentally', { dentally_sync_cursor: null });
            } catch (err) {
                console.warn(`[dentally] checkpoint clear skipped: ${err?.message || err}`);
            }
        }
        // Persisted, not just logged: a log line is gone by morning, and the
        // question this answers ("did the reconcilers actually run, and what did
        // they find?") is asked days later.
        try {
            await integrationRepository.mergeConfig(orgId, 'dentally', { dentally_reconcile: reconcile });
        } catch (err) {
            console.warn(`[dentally] reconcile summary not recorded: ${err?.message || err}`);
        }
        await integrationRepository.upsert(orgId, 'dentally', {
            last_sync_at: new Date().toISOString(),
            last_error: null,
            status: 'active',
        });
        return {
            practitioners: practitioners.synced,
            staff: staff.synced,
            patients: patients.synced,
            appointments: appts.synced,
            appointments_upcoming: upcomingSynced,
            payments: pays.synced,
            treatment_plans: treatmentPlans.synced,
            treatment_items: treatmentItems.synced,
            invoice_items: invoiceItems.synced,
            invoices: invoices.synced,
            skipped_unmatched_practice: (appts.skipped ?? 0) + (pays.skipped ?? 0) + (invoices.skipped ?? 0),
            skipped_closed_appointments: appts.skippedClosed ?? 0,
            relinked_appointment_contacts: relinked,
            relinked_appointment_associates: relinkedAssociates,
            repaid_invoice_items: repaidItems,
            pruned_invoices: prunedInv.deleted ?? 0,
        };
    } catch (err) {
        await integrationRepository.markFailed(orgId, 'dentally', String(err.message).slice(0, 500));
        throw err;
    }
}

// First-connect automation. The ONLY manual step is connect + paste API key;
// everything below runs automatically, in order, so the user never touches
// site detection or practice mapping:
//   1. detect the Dentally site_ids this account returns,
//   2. auto-create one practice per still-unmapped site (so its site_id
//      resolves a practice_id), THEN
//   3. pull the recent window.
// Order matters: the siteMap MUST be populated before the pull, otherwise every
// appointment/payment is skipped as unmatched-practice and the dashboard shows
// all zeros (the bug this replaces — the old blind first-connect sync ran with
// an empty siteMap, and the later backfill was swallowed by the concurrency
// guard against that still-running sync).
export async function bootstrapOnConnect(orgId, integration, onProgress = () => {}) {
    const auth = await resolveDentallyAuth(orgId, integration);
    if (!auth) {
        await integrationRepository.markFailed(orgId, 'dentally', 'no_auth: missing or undecryptable API key');
        return { error: 'no_auth' };
    }
    // 1. detect sites.
    const { siteIds = [] } = await detectSiteIds(orgId, integration);
    // 1a. More than one site and nobody has said which to pull? STOP and ask.
    // A Dentally grant covers the whole group, so pulling on sight is how a
    // sub-account ends up holding four other practices' patients. Only ask when
    // there is a choice to make: one site is not a decision.
    const chosen = allowedSites(integration);
    if (!chosen && siteIds.length > 1) {
        await integrationRepository.mergeConfig(orgId, 'dentally', {
            detected_sites: siteIds,
            awaiting_site_selection: true,
        });
        return { awaitingSiteSelection: true, sitesDetected: siteIds.length, siteIds };
    }
    // 2. create a practice for each unmapped site the org actually pulls.
    let practicesCreated = 0;
    if (siteIds.length) {
        const { data: existing } = await supabase_1.serviceClient
            .from('practices')
            .select('pms_site_id')
            .eq('organisation_id', orgId)
            .not('pms_site_id', 'is', null);
        const mapped = new Set((existing ?? []).map((p) => String(p.pms_site_id)));
        const toCreate = siteIds.filter(
            (s) => !mapped.has(String(s.site_id)) && keepSite(chosen, s.site_id),
        );
        for (const s of toCreate) {
            const { error } = await supabase_1.serviceClient.from('practices').insert({
                organisation_id: orgId,
                name: s.name || `Dentally site ${String(s.site_id).slice(0, 8)}`,
                pms_site_id: s.site_id,
            });
            // A duplicate (re-connect, or a concurrent map) is not fatal — the
            // site is already mapped, which is all the pull needs.
            if (error) console.warn(`[dentally] bootstrap: practice for site ${s.site_id} not created: ${error.message}`);
            else practicesCreated++;
        }
    }
    // 3. pull the recent window with the now-populated siteMap.
    //
    // Record that a first pull is in flight BEFORE running it. Nothing else
    // knows: last_sync_at is only stamped on completion, so a process restart
    // mid-bootstrap (a deploy will do it) leaves a half-filled tenant that looks
    // identical to one that was never connected. This marker is what
    // resumeInterruptedImports finds afterwards.
    await markBootstrapStarted(orgId, 'dentally', integration);

    const result = await syncOneOrg(orgId, integration, onProgress, { recent: true });

    // Finished — nothing to resume. An errored run keeps the marker so the
    // sweep retries it.
    if (!result?.error) await markBootstrapFinished(orgId, 'dentally');
    return { sitesDetected: siteIds.length, practicesCreated, ...result };
}

// Resumable, per-run-bounded one-time backfill of the COMPLETED treatment_plan_items
// history (the Practitioner Activity / "Treatments Completed" feed). Dentally IGNORES
// the date/completed filter on /treatment_plan_items, so the ENTIRE collection
// (hundreds of thousands of rows — 639k for the live group) must be paged to find the
// completed subset. The old path ran this as one all-or-nothing syncOneOrg phase: if
// the process died (dyno recycle / timeout) before the last page, the phase was never
// marked done, the flag never flipped, and the NEXT night restarted from page 1 — a
// permanent stall that left every month under-counting for any large org. This persists
// a PAGE CURSOR (treatment_items_backfill_page) and bounds each run, so a killed run
// resumes where it stopped and the backfill always converges, then flips the one-time
// treatment_items_backfilled flag. Upserts are idempotent, so the small re-pull after a
// crash (back to the last persisted cursor) is harmless.
const TI_BACKFILL_PAGES_PER_RUN = 3000; // ~300k rows/run; resumes from the cursor next run
const TI_BACKFILL_CHECKPOINT_EVERY = 25; // persist the page cursor every N pages

export async function backfillTreatmentItems(orgId, integration) {
    if (integration.config?.treatment_items_backfilled) return { skipped: true };
    const base = integration.config?.base_url ?? DEFAULT_BASE;
    let auth = await resolveDentallyAuth(orgId, integration);
    if (!auth) return { error: 'no_auth' };
    const practiceByPractitioner = await loadPractitionerPracticeMap(orgId);
    // Same rule as the windowed pull: with a site selection, a row whose
    // practice does not resolve belongs to a practice this account did not
    // select. This path pages the WHOLE collection (Dentally ignores every
    // filter on /treatment_plan_items, site_id included — verified live), so
    // without the gate it is the single largest source of other practices'
    // records: it alone put 64,165 unattributed items into a one-practice
    // sub-account.
    const strictAllowed = allowedSites(integration);
    const strict = dropsUnattributed(strictAllowed);
    // Same patient fallback as the windowed pull. Without it this path — which
    // pages the whole collection — would drop every legitimate row whose
    // practitioner is not on the roster.
    const practiceByContact = strict
        ? await loadContactPracticeMap(orgId).catch(() => new Map())
        : new Map();
    const associateMap = await loadPractitionerMap(orgId);
    const contactMap = await loadContactMap(orgId);
    const params = { updated_after: backfillSince() };
    const startPage = Math.max(1, Number(integration.config?.treatment_items_backfill_page) || 1);
    const stopBefore = startPage + TI_BACKFILL_PAGES_PER_RUN; // exclusive per-run ceiling
    let page = startPage;
    let synced = 0;
    let finished = false;
    let rateLimited = false;
    for (;;) {
        const url = new URL(`${base}/treatment_plan_items`);
        for (const [k, v] of Object.entries({ ...params, page, per_page: PER_PAGE })) {
            url.searchParams.set(k, String(v));
        }
        let res = null;
        let lastErr = null;
        for (let attempt = 0; attempt < 7; attempt++) {
            try {
                ({ res, auth } = await dentallyFetchWithRefresh(orgId, auth, url));
            } catch (err) {
                lastErr = err;
                res = null;
                if (attempt < 3) { await sleep(1000 * (attempt + 1)); continue; }
                throw err;
            }
            // Same 429/403 rate-limit handling as streamPages — back off and retry.
            if (await isRateLimited(res)) {
                const retryAfter = Number(res.headers.get('retry-after'));
                await sleep(retryAfter ? retryAfter * 1000 : Math.min(60000, 2000 * 2 ** attempt));
                continue;
            }
            break;
        }
        if (!res) throw lastErr ?? new Error('Dentally /treatment_plan_items: no response');
        // Sustained rate-limit (Dentally's hourly cap) survived every backoff: do NOT
        // throw — STOP gracefully, persist the cursor, and let the next run resume from
        // here. The whole 639k-row collection can't fit one hourly window, so the
        // backfill is designed to converge across runs rather than fail.
        if (await isRateLimited(res)) { rateLimited = true; break; }
        if (!res.ok) throw new Error(`Dentally /treatment_plan_items -> HTTP ${res.status}`);
        const body = await res.json();
        const items = body.treatment_plan_items || [];
        const rows = items
            .filter((it) => it && it.id != null && it.completed === true)
            .map((it) => treatmentItemRow(orgId, it, practiceByPractitioner, associateMap, contactMap, practiceByContact))
            .filter((r) => !strict || r?.practice_id);
        if (rows.length) {
            synced += await upsertChunked('dentally_treatment_items', rows, 'organisation_id,source,pms_external_id');
        }
        if (items.length < PER_PAGE) { finished = true; break; } // reached the end of the collection
        // Persist the NEXT page to fetch periodically so a crash resumes near here.
        if (page % TI_BACKFILL_CHECKPOINT_EVERY === 0) {
            await integrationRepository.mergeConfig(orgId, 'dentally', { treatment_items_backfill_page: page + 1 });
        }
        page++;
        if (page >= stopBefore) break; // per-run bound — persist below and resume next run
        await sleep(RATE_DELAY_MS);
    }
    if (finished) {
        await integrationRepository.mergeConfig(orgId, 'dentally', { treatment_items_backfilled: true, treatment_items_backfill_page: null });
    } else {
        // Rate-limited or hit the per-run bound: save where to resume next run.
        await integrationRepository.mergeConfig(orgId, 'dentally', { treatment_items_backfill_page: page });
    }
    // Re-stamp practice attribution from the org roster (same self-heal as the
    // routine sync) so legacy-backfilled items resolve a practice even if their
    // practitioner landed in the roster after the row was first inserted.
    try {
        await supabase_1.serviceClient.rpc('restamp_treatment_item_practices', { p_org: orgId });
    } catch (err) {
        console.warn(`[dentally] treatment_items practice restamp skipped: ${err?.message || err}`);
    }
    return { synced, finished, rateLimited, lastPage: page };
}

export async function syncAllOrgs() {
    // 'failed' is included on purpose. syncOneOrg calls markFailed on ANY throw
    // — one timeout, one rate-limit burst, one bad page — and markFailed sets
    // status='failed'. Selecting only 'active' meant a single transient error
    // stopped that org syncing FOREVER, silently: no pull, no delete prune, and
    // none of the backfill reconcilers that exist to catch exactly this drift.
    // The org would just stop moving while the app kept serving its stale rows,
    // and nothing on screen would say so. A successful run flips the status back
    // to 'active' by itself (the closing upsert below), so retrying self-heals.
    // 'revoked' stays out: that is a deliberate disconnect with nulled secrets,
    // and retrying it could only generate noise.
    const { data: rows } = await supabase_1.serviceClient
        .from('integrations')
        .select('*')
        .eq('provider', 'dentally')
        .in('status', ['active', 'failed']);
    // Finish any first pull a restart interrupted, before the nightly work.
    // Boot covers the deploy case; this covers a run that died some other way
    // (OOM, an upstream stall) on a process that never restarted.
    try {
        const { resumeInterruptedImports } = await import('./bootstrap-recovery.js');
        await resumeInterruptedImports();
    } catch (err) {
        console.error(`[dentally] nightly bootstrap sweep failed: ${err?.message || err}`);
    }

    const results = [];
    for (const row of rows ?? []) {
        try {
            // The on-connect pull is the 1-year first-fill window. The FIRST
            // nightly run after connect re-pulls the trailing 6-month window
            // (backfillSince()) to settle any edits, then flips a one-time flag so
            // every subsequent run rides the cheap incremental changed-since cursor.
            const needsBackfill = !row.config?.history_backfilled;
            const r = await syncOneOrg(row.organisation_id, row, () => {}, { full: needsBackfill });
            if (needsBackfill && !r.error) {
                // The full pull above already pulled treatment_plan_items over the
                // backfill window, so the Practitioner Activity feed is seeded too.
                await integrationRepository.mergeConfig(row.organisation_id, 'dentally', { history_backfilled: true, treatment_items_backfilled: true });
            }
            // One-time treatment_plan_items backfill for orgs connected BEFORE the
            // Practitioner Activity feed existed: history is already backfilled, so
            // the nightly run rides the incremental cursor and would only ever pick
            // up NEW completions — never the ~18 months of history the card needs.
            // Run a SELECTIVE full pull of just that resource (cheap vs a full
            // re-sync of patients/appointments/invoices) over the backfill window,
            // resolving practice/associate/contact from the already-synced maps, then
            // flip a one-time flag so it never repeats.
            let itemBackfill = 0;
            if (!needsBackfill && !r.error && !row.config?.treatment_items_backfilled) {
                try {
                    // Resumable + per-run bounded: converges over consecutive runs and
                    // sets treatment_items_backfilled itself when it reaches the end, so a
                    // dyno recycle mid-pull no longer restarts from page 1 every night.
                    const ib = await backfillTreatmentItems(row.organisation_id, row);
                    itemBackfill = ib?.synced ?? 0;
                } catch (err) {
                    console.warn(`[dentally] treatment_items backfill skipped for ${row.organisation_id}: ${err?.message || err}`);
                }
            }
            results.push({ orgId: row.organisation_id, backfill: needsBackfill, treatment_items_backfill: itemBackfill, ...r });
        } catch (err) {
            // Per-org isolation: one org's failure never blocks the others.
            results.push({ orgId: row.organisation_id, error: err.message });
        }
    }
    return results;
}

// Exported for unit tests.
export const __test = { fetchAllPages, streamPages, fetchPageCount, weightedPct, reportPct, isOpenAppointment, mapAppointmentStatus, mapPaymentStatus, mapPaymentMethod, toPence, treatmentPlanRow, invoiceItemRow, invoiceTreatment, paymentRow, classifyWebhook, selectStaleAppointmentIds, selectStalePaymentIds, isRateLimited };
