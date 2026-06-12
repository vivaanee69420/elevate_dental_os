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
import { decryptSecret } from "../crypto.js";
import * as supabase_1 from "../supabase.js";

const DEFAULT_BASE = 'https://api.dentally.co/v1';
const USER_AGENT = 'ElevateOS/1.0 (integrations@elevate.app)';
const PER_PAGE = 100;
const RATE_DELAY_MS = 120;   // ~8 req/s, under Dentally's ~10/s cap
const UPSERT_CHUNK = 500;
const REQUEST_TIMEOUT_MS = 30000; // abort a hung Dentally request, never hang forever
const MAX_PAGES = 100;       // cap a single sync to 100 pages/resource (~10k rows) so a foreground Refresh stays bounded; the incremental cursor catches the rest next run
const BACKFILL_MAX_PAGES = 5000; // full backfill ceiling (~500k rows/resource) — one-off, pulls the 2-year window
const BACKFILL_YEARS = 2;        // full backfill cap: most-recent 2 years of history, no deeper (product rule)
// Rolling 2-year updated_after for full pulls. Dentally requires the param; we
// deliberately cap history at 2 years rather than pulling all-time (was a 2005
// anchor) so a backfill stays bounded on long-lived practices.
function backfillSince() {
    return new Date(Date.now() - BACKFILL_YEARS * 365 * 86400000).toISOString();
}
const RECENT_MONTHS = 12;        // on-connect bootstrap window: last 12 months — a fast connect that lands a full year (dashboards are TTM); the nightly cron deepens the rest of history overnight (see syncAllOrgs one-time backfill)
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

function authHeader(secrets) {
    try {
        const parsed = JSON.parse(decryptSecret(secrets));
        return parsed.apiKey ? `Bearer ${parsed.apiKey}` : null;
    } catch {
        return null;
    }
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
async function streamPages(base, path, auth, params, onBatch, onPage = null, maxPages = MAX_PAGES) {
    let page = 1;
    let fetched = 0;
    for (;;) {
        const url = new URL(`${base}${path}`);
        for (const [k, v] of Object.entries({ ...params, page, per_page: PER_PAGE })) {
            url.searchParams.set(k, String(v));
        }
        let res = null;
        let lastErr = null;
        for (let attempt = 0; attempt < 4; attempt++) {
            try {
                res = await fetchWithTimeout(url, {
                    headers: { Authorization: auth, 'User-Agent': USER_AGENT, Accept: 'application/json' },
                });
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
            if (res.status === 429) {
                const retryAfter = Number(res.headers.get('retry-after')) || 2;
                await sleep(retryAfter * 1000);
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

// Collect every page into a flat array. Thin wrapper over streamPages for the
// small, unweighted resources (practitioners, users) where buffering the whole
// set is cheap. The heavy resources stream-upsert per page instead (see pulls).
async function fetchAllPages(base, path, auth, params, onPage = null, maxPages = MAX_PAGES) {
    const out = [];
    await streamPages(base, path, auth, params, (items) => { out.push(...items); }, onPage, maxPages);
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
// On the bootstrap pull that hits the patients phase, which pulls the 2-year
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

async function fetchPageCount(base, path, auth, params, maxPages = MAX_PAGES) {
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
    const auth = authHeader(integration.secrets);
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
function mapPaymentMethod(m) {
    const v = String(m ?? '').trim().toLowerCase();
    if (!v) return null;
    const canon = {
        'card': 'card', 'credit card': 'card', 'debit card': 'card',
        'card on file': 'card', 'card_on_file': 'card', 'stripe': 'card',
        'cash': 'cash',
        'cheque': 'cheque', 'check': 'cheque',
        'bacs': 'bank_transfer', 'bank transfer': 'bank_transfer',
        'bank_transfer': 'bank_transfer', 'direct credit': 'bank_transfer',
        'direct debit': 'direct_debit', 'direct_debit': 'direct_debit',
        'finance': 'finance',
        'apple pay': 'apple_pay', 'apple_pay': 'apple_pay',
        'google pay': 'google_pay', 'google_pay': 'google_pay',
        'pay link': 'pay_link', 'pay_link': 'pay_link',
    };
    return canon[v] ?? v.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
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

// Build { dentally patient id -> contacts.id } for the org (source='dentally').
// Paginated: PostgREST caps a select at 1000 rows, so without ranging the map
// would silently drop patients beyond the first 1000 and their payments/appts
// would never link a contact.
async function loadContactMap(orgId) {
    const map = new Map();
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase_1.serviceClient
            .from('contacts')
            .select('id, pms_external_id')
            .eq('organisation_id', orgId)
            .eq('source', 'dentally')
            .not('pms_external_id', 'is', null)
            .range(from, from + PAGE - 1);
        if (error) throw new Error(error.message);
        const rows = data ?? [];
        for (const c of rows) map.set(String(c.pms_external_id), c.id);
        if (rows.length < PAGE) break;
    }
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
// raw ids persisted so they can be relinked on a later run.
export function treatmentPlanRow(orgId, tp, associateMap = new Map(), contactMap = new Map()) {
    const numOrNull = (v) => (v == null || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
    return {
        organisation_id: orgId,
        source: 'dentally',
        pms_external_id: String(tp.id),
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

// ---- pulls ------------------------------------------------------------------

async function pullPatients(orgId, base, auth, params, siteMap, onPage, maxPages) {
    let synced = 0;
    await streamPages(base, '/patients', auth, params, async (items) => {
        const rows = items.map((p) => patientRow(orgId, p, siteMap));
        synced += await upsertChunked('contacts', rows, 'organisation_id,source,pms_external_id');
    }, onPage, maxPages);
    return { synced };
}

async function pullPractitioners(orgId, base, auth, params, siteMap, maxPages) {
    const remote = await fetchAllPages(base, '/practitioners', auth, params, null, maxPages);
    const rows = remote
        .filter((p) => p && p.id != null)
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
    const auth = authHeader(integration.secrets);
    if (!auth) return { error: 'no_auth' };
    const siteMap = await loadSiteMap(orgId);
    return pullPractitioners(orgId, base, auth, {}, siteMap, BACKFILL_MAX_PAGES);
}

// Dentally `/users` -> staff roster. Small set (whole-practice team), so one
// unfiltered pull each sync; upsert is idempotent on (org, source, pms id).
async function pullUsers(orgId, base, auth, params, siteMap, maxPages) {
    const remote = await fetchAllPages(base, '/users', auth, params, null, maxPages);
    const rows = remote
        .filter((u) => u && u.id != null)
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
    await streamPages(base, '/appointments', auth, params, async (items) => {
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
export async function reconcileDeletedAppointments(orgId, base, auth, { sinceISO, untilISO, maxPages = MAX_PAGES } = {}) {
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
        for (const [k, v] of Object.entries({ ...params, page, per_page: PER_PAGE })) url.searchParams.set(k, String(v));
        let res = null;
        try {
            res = await fetchWithTimeout(url, { headers: { Authorization: auth, 'User-Agent': USER_AGENT, Accept: 'application/json' } });
        } catch {
            return { deleted: 0, aborted: 'fetch_error' }; // partial -> never delete
        }
        if (res.status === 429) { const ra = Number(res.headers.get('retry-after')) || 2; await sleep(ra * 1000); continue; }
        if (!res.ok) return { deleted: 0, aborted: `http_${res.status}` };
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
        const { data, error } = await supabase_1.serviceClient
            .from('appointments')
            .select('id, pms_external_id')
            .eq('organisation_id', orgId)
            .eq('source', 'dentally')
            .gte('starts_at', sinceISO)
            .lt('starts_at', untilISO)
            .not('pms_external_id', 'is', null)
            .range(from, from + PAGE - 1);
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

async function pullPayments(orgId, base, auth, params, siteMap, contactMap, onPage, maxPages) {
    let synced = 0;
    let skipped = 0;
    await streamPages(base, '/payments', auth, params, async (items) => {
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

async function pullTreatmentPlans(orgId, base, auth, params, associateMap, contactMap, onPage, maxPages) {
    let synced = 0;
    await streamPages(base, '/treatment_plans', auth, params, async (items) => {
        const rows = items
            .filter((tp) => tp && tp.id != null)
            .map((tp) => treatmentPlanRow(orgId, tp, associateMap, contactMap));
        synced += await upsertChunked('treatment_plans', rows, 'organisation_id,source,pms_external_id');
    }, onPage, maxPages);
    return { synced };
}

async function pullInvoiceItems(orgId, base, auth, params, invoiceMap, practitionerMap, onPage, maxPages) {
    let synced = 0;
    await streamPages(base, '/invoice_items', auth, params, async (items) => {
        const rows = items
            .filter((it) => it && it.id != null)
            .map((it) => invoiceItemRow(orgId, it, invoiceMap, practitionerMap));
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
    await streamPages(base, '/invoices', auth, params, async (items) => {
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
        const auth = authHeader(integ.secrets);
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

export async function applyWebhookEvent(orgId, resourceType, record, action = 'upsert') {
    if (!record || record.id == null) return { ignored: 'no_record_id' };
    if (action === 'delete') {
        const m = WEBHOOK_TABLE[resourceType];
        if (!m) return { ignored: resourceType };
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
    const contactMap = await loadContactMap(orgId);
    if (resourceType === 'appointment') {
        const practitionerMap = await loadPractitionerMap(orgId);
        const row = appointmentRow(orgId, record, siteMap, contactMap, practitionerMap);
        if (!row) return { skipped: 'unmatched_practice' };
        await upsertChunked('appointments', [row], 'organisation_id,source,pms_external_id');
        return { table: 'appointments', applied: 1 };
    }
    if (resourceType === 'payment') {
        const row = paymentRow(orgId, record, siteMap, contactMap);
        if (!row) return { skipped: 'unmatched_practice' };
        await upsertChunked('payments', [row], 'organisation_id,source,external_id');
        return { table: 'payments', applied: 1 };
    }
    if (resourceType === 'invoice') {
        const row = invoiceRow(orgId, record, siteMap, contactMap);
        if (!row) return { skipped: 'unmatched_practice' };
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
        const row = treatmentPlanRow(orgId, record, associateMap, contactMap);
        await upsertChunked('treatment_plans', [row], 'organisation_id,source,pms_external_id');
        return { table: 'treatment_plans', applied: 1 };
    }
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
    const auth = authHeader(integration.secrets);
    if (!auth) {
        await integrationRepository.markFailed(orgId, 'dentally', 'no_auth: missing or undecryptable API key');
        return { error: 'no_auth' };
    }
    // Window selection — ONE window, shared by patients / appointments /
    // payments (all filtered by `updated_after`):
    //  - full   : the most-recent 2 years (backfillSince()) with a lifted page cap.
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
    // full pull re-pulls the same 2-year window from page 1 every time. We record
    // which heavy phases finished, keyed by the backfill window (day-bucketed:
    // backfillSince() shifts each ms, so an exact-timestamp key would never match
    // a later run; the window only moves a day at a time). A re-run for the same
    // day skips finished phases; already-upserted rows are idempotent regardless.
    // Resume only the unscoped full backfill (the long, OOM-prone path). A
    // selective run is short and the user explicitly asked for those resources,
    // so honour the pick every time rather than skipping a phase a prior run
    // happened to finish.
    const resumeMode = full && !selective;
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
    // empty. A bounded 2-year historical pull is the deliberate trade: a few
    // more pages on connect for a dataset every module can actually use.
    // `cancelled: true` is REQUIRED — Dentally's GET /appointments defaults to
    // cancelled=false, which silently drops BOTH cancelled AND did_not_attend
    // (DNA) appointments. Without it we never store a single no_show row (so the
    // no-show rate shows "—, not tracked") and our appointment totals understate
    // Dentally's "found" count by the cancelled volume (~19% at a busy site).
    // mapAppointmentStatus already maps cancelled -> 'cancelled' and DNA ->
    // 'no_show'; this just stops the API from withholding those rows.
    const apptParams = { updated_after: since, cancelled: true };
    const patientParams = { updated_after: since };
    // /payments has NO `updated_after` — Dentally's List-payments endpoint only
    // filters by payment date (`dated_after`/`dated_before` on `dated_on`). An
    // unknown param is silently ignored and the WHOLE history comes back every
    // sync (the runaway "1800 payments and climbing" re-pull). `dated_after`
    // takes a date, so window to the day; same-day rows re-pull harmlessly
    // (upsert dedups on org+source+external_id). Trade-off: a back-dated edit to
    // an OLD payment won't surface incrementally (its `dated_on` predates the
    // window) — the periodic full backfill (dated_after = 2y ago) reconciles those.
    const payParams = { dated_after: since.slice(0, 10) };
    const invoiceParams = { updated_after: since };

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
    const PHASES = ['patients', 'appointments', 'payments', 'treatment_plans', 'invoices', 'invoice_items'];
    // Only probe (and below, only pull) the selected resources. An unselected
    // phase contributes 0 pages to the weighted total and is never fetched, so
    // the bar paces over exactly the work that runs.
    const probe = (k, path, params) => want(k) ? fetchPageCount(base, path, auth, params, maxPages) : Promise.resolve(0);
    const [patientPages, apptPages, payPages, planPages, invoicePages, itemPages] = await Promise.all([
        probe('patients', '/patients', patientParams),
        probe('appointments', '/appointments', apptParams),
        probe('payments', '/payments', payParams),
        probe('treatment_plans', '/treatment_plans', { updated_after: since }),
        probe('invoices', '/invoices', invoiceParams),
        probe('invoices', '/invoice_items', { updated_after: since }),
    ]);
    const phaseTotals = [patientPages, apptPages, payPages, planPages, invoicePages, itemPages];
    const reporter = (idx) => (page, totalPages, count) => {
        // reportPct grows phaseTotals from the live pull so an under-counting
        // probe (no meta.total_pages -> 1, or a timed-out probe -> 0) can't
        // freeze the bar at 0% for a whole phase. See reportPct's comment.
        // count = records fetched so far this phase, surfaced live in the UI.
        onProgress({ phase: PHASES[idx], pct: reportPct(phaseTotals, idx, page, totalPages), page, totalPages, count });
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
        // Practitioners first (cheap, no separate progress phase) so the
        // appointment pull can resolve associate_id. Use the same updated_after
        // window as patients (2-year backfillSince() on full/bootstrap so all
        // staff in that window are captured; incremental cursor for routine syncs).
        // Practitioners + staff are small (whole-practice team), so they aren't
        // weighted, but we emit a phase label + live count so the overlay shows
        // "Practitioners · N pulled" instead of dead air at pct 0 before patients.
        let practitioners = { synced: 0 };
        // Practitioners resolve associate_id on appointments + treatment_plans;
        // skip the pull when neither is selected (e.g. a patients-only run).
        if (want('appointments') || want('treatment_plans')) {
            onProgress({ phase: 'practitioners', pct: 0, count: 0 });
            try {
                practitioners = await pullPractitioners(orgId, base, auth, patientParams, siteMap, maxPages);
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
            staff = await pullUsers(orgId, base, auth, {}, siteMap, maxPages);
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
            patients = await pullPatients(orgId, base, auth, patientParams, siteMap, reporter(0), maxPages);
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
                const upcoming = await pullAppointments(orgId, base, auth, { after: new Date().toISOString(), cancelled: true }, siteMap, contactMap, null, maxPages, { practitionerMap });
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
        let pruned = { deleted: 0 };
        if (!recent && want('appointments')) {
            try {
                const wMs = 35 * 86400000;
                const reconSince = new Date(Date.now() - wMs).toISOString();
                const reconUntil = new Date(Date.now() + wMs).toISOString();
                pruned = await reconcileDeletedAppointments(orgId, base, auth, { sinceISO: reconSince, untilISO: reconUntil, maxPages });
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
        // Treatment plans = production per practitioner (for the Associate Pay
        // Run). Same window as payments; reuse the practitioner + contact maps to
        // resolve associate_id / contact_id. Weighted phase 3; never fail the
        // whole sync if this resource errors.
        let treatmentPlans = { synced: 0 };
        if (want('treatment_plans') && !completedPhases.has('treatment_plans')) {
            try {
                treatmentPlans = await pullTreatmentPlans(orgId, base, auth, { updated_after: since }, practitionerMap, contactMap, reporter(3), maxPages);
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
                invoiceItems = await pullInvoiceItems(orgId, base, auth, { updated_after: since }, invoices.invoiceMap ?? new Map(), practitionerMap, reporter(5), maxPages);
            } catch (err) {
                console.warn(`[dentally] invoice_items pull skipped: ${err?.message || err}`);
            }
            await markPhaseDone('invoices');
            await markPhaseDone('invoice_items');
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
            invoice_items: invoiceItems.synced,
            invoices: invoices.synced,
            skipped_unmatched_practice: (appts.skipped ?? 0) + (pays.skipped ?? 0) + (invoices.skipped ?? 0),
            skipped_closed_appointments: appts.skippedClosed ?? 0,
            relinked_appointment_contacts: relinked,
            relinked_appointment_associates: relinkedAssociates,
            repaid_invoice_items: repaidItems,
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
    const auth = authHeader(integration.secrets);
    if (!auth) {
        await integrationRepository.markFailed(orgId, 'dentally', 'no_auth: missing or undecryptable API key');
        return { error: 'no_auth' };
    }
    // 1. detect sites + 2. create a practice for each unmapped site.
    const { siteIds = [] } = await detectSiteIds(orgId, integration);
    let practicesCreated = 0;
    if (siteIds.length) {
        const { data: existing } = await supabase_1.serviceClient
            .from('practices')
            .select('pms_site_id')
            .eq('organisation_id', orgId)
            .not('pms_site_id', 'is', null);
        const mapped = new Set((existing ?? []).map((p) => String(p.pms_site_id)));
        const toCreate = siteIds.filter((s) => !mapped.has(String(s.site_id)));
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
    const result = await syncOneOrg(orgId, integration, onProgress, { recent: true });
    return { sitesDetected: siteIds.length, practicesCreated, ...result };
}

export async function syncAllOrgs() {
    const { data: rows } = await supabase_1.serviceClient
        .from('integrations')
        .select('*')
        .eq('provider', 'dentally')
        .eq('status', 'active');
    const results = [];
    for (const row of rows ?? []) {
        try {
            // The on-connect pull is deliberately a fast 1-year window. The FIRST
            // nightly run after connect deepens it to the full 2-year window
            // (backfillSince()) — the "rest done overnight" — then flips a
            // one-time flag so every
            // subsequent run rides the cheap incremental changed-since cursor.
            const needsBackfill = !row.config?.history_backfilled;
            const r = await syncOneOrg(row.organisation_id, row, () => {}, { full: needsBackfill });
            if (needsBackfill && !r.error) {
                await integrationRepository.mergeConfig(row.organisation_id, 'dentally', { history_backfilled: true });
            }
            results.push({ orgId: row.organisation_id, backfill: needsBackfill, ...r });
        } catch (err) {
            // Per-org isolation: one org's failure never blocks the others.
            results.push({ orgId: row.organisation_id, error: err.message });
        }
    }
    return results;
}

// Exported for unit tests.
export const __test = { fetchAllPages, streamPages, fetchPageCount, weightedPct, reportPct, isOpenAppointment, mapAppointmentStatus, mapPaymentStatus, mapPaymentMethod, toPence, authHeader, treatmentPlanRow, invoiceItemRow, invoiceTreatment, paymentRow, classifyWebhook };
