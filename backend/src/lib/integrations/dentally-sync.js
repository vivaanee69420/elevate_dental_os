// Dentally sync — polls the Dentally v1 REST API per active org integration and
// upserts patients/appointments/payments into our tables with source='dentally'.
//
// Webhooks are unreliable for some Dentally events, so this 30-min poller closes
// the gap (Stripe/Xero use webhooks; Dentally + SOE use this).
//
// Idempotent: upserts on (organisation_id, source, external_id) — re-polling the
// same window updates rows in place, never duplicates (migration 20260101000014).
//
//   GET /v1/patients?updated_since=<ISO>      -> contacts   (pms_external_id)
//   GET /v1/appointments?updated_since=<ISO>  -> appointments (pms_external_id)
//   GET /v1/payments?updated_since=<ISO>      -> payments    (external_id)
//
// Per Dentally docs (elevate-complete/04-integrations/DENTALLY_SETUP.md):
//   - Authorization: Bearer <apiKey>  (decrypted from integrations.secrets)
//   - User-Agent header is MANDATORY (requests without it are rejected)
//   - Rate limit ~10 req/s; back off on 429 Retry-After
//   - Pagination: page + per_page=100, meta.total_pages, response wrapped in a key
//   - A date filter is mandatory (we always pass updated_since)
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
const BACKFILL_MAX_PAGES = 5000; // full backfill ceiling (~500k rows/resource) — one-off, pulls all history
const BACKFILL_SINCE = '2005-01-01T00:00:00.000Z'; // far-back updated_since so a full pull sees all records (API requires the param)
const RECENT_MONTHS = 24;        // on-connect bootstrap window: last 24 months (dashboards are TTM; the cron + full-history button deepen the rest)
const BOOTSTRAP_MAX_PAGES = 600; // ~60k rows/resource cap for the on-connect pull, so onboarding finishes in a couple of minutes
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

// Page through a Dentally collection endpoint. Honours 429 Retry-After and the
// mandatory User-Agent + date filter. Returns the flat array of items.
async function fetchAllPages(base, path, auth, params, onPage = null, maxPages = MAX_PAGES) {
    const out = [];
    let page = 1;
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
        out.push(...items);
        const totalPages = body.meta?.total_pages;
        // out.length = records fetched so far this phase, so the UI can show
        // "1,247 records pulled" live (Dentally often omits total_pages, so a
        // running count is the clearest signal of what's happening).
        if (onPage) onPage(page, totalPages ? Math.min(totalPages, maxPages) : null, out.length);
        const done = totalPages ? page >= totalPages : items.length < PER_PAGE;
        if (done) break;
        if (page >= maxPages) { // bound a single run; cursor resumes next sync
            console.warn(`[dentally] ${path}: hit ${maxPages}-page cap (${out.length} rows), stopping this run`);
            break;
        }
        page++;
        await sleep(RATE_DELAY_MS);
    }
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
// On the bootstrap pull that hits the patients phase, which pulls ALL patients
// (updated_since=2005) — the longest phase — so weighting it as ~1 page made
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
        fetchOnePage(base, '/patients', auth, { updated_since: since }).catch(() => []),
        fetchOnePage(base, '/appointments', auth, { updated_since: since }).catch(() => []),
        fetchOnePage(base, '/payments', auth, { updated_since: since }).catch(() => []),
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
    switch (String(s || '').toLowerCase()) {
        case 'confirmed': return 'confirmed';
        case 'in_progress': case 'arrived': return 'in_progress';
        case 'completed': case 'finished': return 'completed';
        case 'cancelled': case 'canceled': return 'cancelled';
        case 'did_not_attend': case 'dna': case 'fta': case 'failed_to_attend': return 'no_show';
        default: return 'scheduled';
    }
}

function mapPaymentStatus(p) {
    if (p?.paid === true) return 'settled';
    switch (String(p?.state || p?.status || '').toLowerCase()) {
        case 'paid': case 'settled': return 'settled';
        case 'failed': case 'declined': return 'failed';
        case 'refunded': return 'refunded';
        default: return 'pending';
    }
}

function mapPaymentMethod(m) {
    const v = String(m || '').toLowerCase();
    const allowed = ['card', 'apple_pay', 'google_pay', 'bank_transfer', 'cash', 'direct_debit', 'finance', 'card_on_file', 'pay_link'];
    return allowed.includes(v) ? v : null;
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
        email: p.email_address ?? p.email ?? null,
        phone: p.mobile_phone ?? p.phone_number ?? null,
        date_of_birth: p.date_of_birth ?? null,
        practice_id: siteMap.get(String(p.site_id)) ?? null,
    };
}

export function practitionerRow(orgId, p, siteMap) {
    const name = p.name
        || [p.first_name, p.last_name].filter(Boolean).join(' ').trim()
        || `Practitioner ${p.id}`;
    return {
        organisation_id: orgId,
        pms_external_id: String(p.id),
        full_name: name,
        email: p.email_address ?? p.email ?? null,
        primary_practice_id: siteMap.get(String(p.site_id)) ?? null,
        active: p.active !== false,
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

// ---- pulls ------------------------------------------------------------------

async function pullPatients(orgId, base, auth, params, siteMap, onPage, maxPages) {
    const remote = await fetchAllPages(base, '/patients', auth, params, onPage, maxPages);
    const rows = remote.map((p) => patientRow(orgId, p, siteMap));
    const synced = await upsertChunked('contacts', rows, 'organisation_id,source,pms_external_id');
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

// openOnly (the first pull): keep only upcoming + not-yet-closed appointments.
// Even when the server-side `after` filter narrows the set, enforce it here too
// so correctness never depends on a remote filter we can't unit-test.
export function isOpenAppointment(row, now = Date.now()) {
    if (CLOSED_APPT_STATES.has(row.status)) return false;
    return new Date(row.starts_at).getTime() >= now;
}

async function pullAppointments(orgId, base, auth, params, siteMap, contactMap, onPage, maxPages, { openOnly = false, practitionerMap = new Map() } = {}) {
    const remote = await fetchAllPages(base, '/appointments', auth, params, onPage, maxPages);
    const now = Date.now();
    const rows = [];
    let skipped = 0;       // unmatched practice (NOT NULL practice_id) — a data-mapping gap
    let skippedClosed = 0; // dropped by the first-pull open filter — expected, not a gap
    for (const a of remote) {
        const row = appointmentRow(orgId, a, siteMap, contactMap, practitionerMap);
        if (!row) { skipped++; continue; } // appointments.practice_id is NOT NULL
        if (openOnly && !isOpenAppointment(row, now)) { skippedClosed++; continue; }
        rows.push(row);
    }
    const synced = await upsertChunked('appointments', rows, 'organisation_id,source,pms_external_id');
    return { synced, skipped, skippedClosed };
}

async function pullPayments(orgId, base, auth, params, siteMap, contactMap, onPage, maxPages) {
    const remote = await fetchAllPages(base, '/payments', auth, params, onPage, maxPages);
    const rows = [];
    let skipped = 0;
    for (const p of remote) {
        const row = paymentRow(orgId, p, siteMap, contactMap);
        if (!row) { skipped++; continue; } // payments.practice_id is NOT NULL
        rows.push(row);
    }
    const synced = await upsertChunked('payments', rows, 'organisation_id,source,external_id');
    return { synced, skipped };
}

// ---- webhook apply (real-time, single record) -------------------------------
// Map+upsert ONE record pushed by a Dentally webhook, reusing the row builders
// above. resourceType ∈ patient|appointment|payment. create/update both upsert
// (idempotent). Returns a small result for logging. Field/event shapes are the
// documented v1 assumptions — verify against the live webhook during UAT.
export async function applyWebhookEvent(orgId, resourceType, record) {
    if (!record || record.id == null) return { ignored: 'no_record_id' };
    const siteMap = await loadSiteMap(orgId);
    if (resourceType === 'patient') {
        await upsertChunked('contacts', [patientRow(orgId, record, siteMap)], 'organisation_id,source,pms_external_id');
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
    return { ignored: resourceType };
}

// ---- orchestration ----------------------------------------------------------

export async function syncOneOrg(orgId, integration, onProgress = () => {}, { full = false, recent = false } = {}) {
    const base = integration.config?.base_url ?? DEFAULT_BASE;
    const auth = authHeader(integration.secrets);
    if (!auth) {
        await integrationRepository.markFailed(orgId, 'dentally', 'no_auth: missing or undecryptable API key');
        return { error: 'no_auth' };
    }
    // Window selection — ONE window, shared by patients / appointments /
    // payments (all filtered by `updated_since`):
    //  - full   : all history (BACKFILL_SINCE) with a lifted page cap.
    //  - recent : the on-connect bootstrap — last RECENT_MONTHS (2 years). A
    //             fresh org lands a complete, bounded 2-year dataset including
    //             COMPLETED appointments, so Associates / Treatment Mix / Pay
    //             have the historical rows they need (not just the upcoming
    //             diary).
    //  - else   : incremental cursor — changed-since last successful sync
    //             (default 30d on first run).
    const since = full
        ? BACKFILL_SINCE
        : recent
            ? new Date(Date.now() - RECENT_MONTHS * 30 * 86400000).toISOString()
            : (integration.last_sync_at ?? new Date(Date.now() - 30 * 86400000).toISOString());
    const maxPages = full ? BACKFILL_MAX_PAGES : recent ? BOOTSTRAP_MAX_PAGES : MAX_PAGES;

    // All three resources pull the same `updated_since` window. The earlier
    // bootstrap fetched upcoming-only appointments (`after=now`) + all-history
    // patients for a fast first paint, but that left every completed appointment
    // — and therefore associate_id / appointment_type / production analytics —
    // empty. A bounded 2-year historical pull is the deliberate trade: a few
    // more pages on connect for a dataset every module can actually use.
    const apptParams = { updated_since: since };
    const patientParams = { updated_since: since };
    const payParams = { updated_since: since };

    // Page-weighted progress. The 3 resources are very unequal (a practice can
    // have ~5x more appointments than patients), so weighting each phase as a
    // flat 1/3 made the bar pace wildly and the headline % disagree with the
    // visible "page X of Y". Instead probe total_pages for all 3 resources up
    // front (one cheap request each), sum to a grand total, and report overall
    // pct = cumulative-pages-done / grand-total. The number now matches reality
    // and moves smoothly. The page-1 probe rows are re-fetched by the pull (one
    // wasted page/resource — negligible against hundreds).
    const PHASES = ['patients', 'appointments', 'payments'];
    const [patientPages, apptPages, payPages] = await Promise.all([
        fetchPageCount(base, '/patients', auth, patientParams, maxPages),
        fetchPageCount(base, '/appointments', auth, apptParams, maxPages),
        fetchPageCount(base, '/payments', auth, payParams, maxPages),
    ]);
    const phaseTotals = [patientPages, apptPages, payPages];
    const reporter = (idx) => (page, totalPages, count) => {
        // reportPct grows phaseTotals from the live pull so an under-counting
        // probe (no meta.total_pages -> 1, or a timed-out probe -> 0) can't
        // freeze the bar at 0% for a whole phase. See reportPct's comment.
        // count = records fetched so far this phase, surfaced live in the UI.
        onProgress({ phase: PHASES[idx], pct: reportPct(phaseTotals, idx, page, totalPages), page, totalPages, count });
    };

    try {
        const siteMap = await loadSiteMap(orgId);
        // Practitioners first (cheap, no separate progress phase) so the
        // appointment pull can resolve associate_id. Use the same updated_since
        // window as patients (BACKFILL_SINCE on full/bootstrap so all staff are
        // captured; incremental cursor for routine syncs).
        let practitioners = { synced: 0 };
        try {
            practitioners = await pullPractitioners(orgId, base, auth, patientParams, siteMap, maxPages);
        } catch (err) {
            console.warn(`[dentally] practitioners pull skipped: ${err?.message || err}`);
        }
        const practitionerMap = await loadPractitionerMap(orgId);
        // Patients first so appointment/payment contact resolution sees fresh ids.
        const patients = await pullPatients(orgId, base, auth, patientParams, siteMap, reporter(0), maxPages);
        const contactMap = await loadContactMap(orgId);
        // openOnly defaults false: store every appointment in the window
        // (completed history included), not just upcoming diary blocks.
        const appts = await pullAppointments(orgId, base, auth, apptParams, siteMap, contactMap, reporter(1), maxPages, { practitionerMap });
        const pays = await pullPayments(orgId, base, auth, payParams, siteMap, contactMap, reporter(2), maxPages);
        // Backfill contact_id for any appointment that has a Dentally patient id
        // but no linked contact yet (patient pulled in another run, or a row
        // from before this column existed). Set-based; cheap; never cross-tenant.
        let relinked = 0;
        try {
            const { data } = await supabase_1.serviceClient.rpc('relink_dentally_appointment_contacts', { p_org: orgId });
            relinked = typeof data === 'number' ? data : 0;
        } catch (err) {
            console.warn(`[dentally] relink contacts skipped: ${err?.message || err}`);
        }
        // Same pattern for associate_id: appointments persist pms_practitioner_id,
        // so a practitioner pulled/mapped after the appointment was synced (or a
        // /practitioners pull that only succeeds on a later run) backfills
        // associate_id without a full appointment re-pull.
        let relinkedAssociates = 0;
        try {
            const { data } = await supabase_1.serviceClient.rpc('relink_dentally_appointment_associates', { p_org: orgId });
            relinkedAssociates = typeof data === 'number' ? data : 0;
        } catch (err) {
            console.warn(`[dentally] relink associates skipped: ${err?.message || err}`);
        }
        await integrationRepository.upsert(orgId, 'dentally', {
            last_sync_at: new Date().toISOString(),
            last_error: null,
            status: 'active',
        });
        return {
            practitioners: practitioners.synced,
            patients: patients.synced,
            appointments: appts.synced,
            payments: pays.synced,
            skipped_unmatched_practice: (appts.skipped ?? 0) + (pays.skipped ?? 0),
            skipped_closed_appointments: appts.skippedClosed ?? 0,
            relinked_appointment_contacts: relinked,
            relinked_appointment_associates: relinkedAssociates,
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
            const r = await syncOneOrg(row.organisation_id, row);
            results.push({ orgId: row.organisation_id, ...r });
        } catch (err) {
            // Per-org isolation: one org's failure never blocks the others.
            results.push({ orgId: row.organisation_id, error: err.message });
        }
    }
    return results;
}

// Exported for unit tests.
export const __test = { fetchAllPages, fetchPageCount, weightedPct, reportPct, isOpenAppointment, mapAppointmentStatus, mapPaymentStatus, mapPaymentMethod, toPence, authHeader };
