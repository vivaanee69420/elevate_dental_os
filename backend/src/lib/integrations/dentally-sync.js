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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
async function fetchAllPages(base, path, auth, params) {
    const out = [];
    let page = 1;
    for (;;) {
        const url = new URL(`${base}${path}`);
        for (const [k, v] of Object.entries({ ...params, page, per_page: PER_PAGE })) {
            url.searchParams.set(k, String(v));
        }
        let res;
        for (let attempt = 0; attempt < 4; attempt++) {
            res = await fetch(url, {
                headers: { Authorization: auth, 'User-Agent': USER_AGENT, Accept: 'application/json' },
            });
            if (res.status === 429) {
                const retryAfter = Number(res.headers.get('retry-after')) || 2;
                await sleep(retryAfter * 1000);
                continue;
            }
            break;
        }
        if (!res.ok) throw new Error(`Dentally ${path} -> HTTP ${res.status}`);
        const body = await res.json();
        // Dentally wraps the collection in a key (e.g. { patients: [...], meta }).
        const key = Object.keys(body).find((k) => Array.isArray(body[k]));
        const items = key ? body[key] : [];
        out.push(...items);
        const totalPages = body.meta?.total_pages;
        const done = totalPages ? page >= totalPages : items.length < PER_PAGE;
        if (done) break;
        page++;
        await sleep(RATE_DELAY_MS);
    }
    return out;
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
    for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
        const chunk = rows.slice(i, i + UPSERT_CHUNK);
        const { error } = await supabase_1.serviceClient.from(table).upsert(chunk, { onConflict });
        if (error) throw new Error(`${table} upsert: ${error.message}`);
        synced += chunk.length;
    }
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

// Build { dentally patient id -> contacts.id } for the org (source='dentally').
async function loadContactMap(orgId) {
    const { data } = await supabase_1.serviceClient
        .from('contacts')
        .select('id, pms_external_id')
        .eq('organisation_id', orgId)
        .eq('source', 'dentally')
        .not('pms_external_id', 'is', null);
    const map = new Map();
    for (const c of data ?? []) map.set(String(c.pms_external_id), c.id);
    return map;
}

// ---- pulls ------------------------------------------------------------------

async function pullPatients(orgId, base, auth, since, siteMap) {
    const remote = await fetchAllPages(base, '/patients', auth, { updated_since: since });
    const rows = remote.map((p) => ({
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
    }));
    const synced = await upsertChunked('contacts', rows, 'organisation_id,source,pms_external_id');
    return { synced };
}

async function pullAppointments(orgId, base, auth, since, siteMap, contactMap) {
    const remote = await fetchAllPages(base, '/appointments', auth, { updated_since: since });
    const rows = [];
    let skipped = 0;
    for (const a of remote) {
        const practiceId = siteMap.get(String(a.site_id));
        if (!practiceId) { skipped++; continue; } // appointments.practice_id is NOT NULL
        rows.push({
            organisation_id: orgId,
            source: 'dentally',
            pms_external_id: String(a.id),
            practice_id: practiceId,
            contact_id: contactMap.get(String(a.patient_id)) ?? null,
            starts_at: a.start_time ?? a.start ?? null,
            ends_at: a.finish_time ?? a.finish ?? a.end_time ?? null,
            status: mapAppointmentStatus(a.state ?? a.status),
        });
    }
    const synced = await upsertChunked('appointments', rows, 'organisation_id,source,pms_external_id');
    return { synced, skipped };
}

async function pullPayments(orgId, base, auth, since, siteMap, contactMap) {
    const remote = await fetchAllPages(base, '/payments', auth, { updated_since: since });
    const rows = [];
    let skipped = 0;
    for (const p of remote) {
        const practiceId = siteMap.get(String(p.site_id));
        if (!practiceId) { skipped++; continue; } // payments.practice_id is NOT NULL
        rows.push({
            organisation_id: orgId,
            source: 'dentally',
            external_id: String(p.id),
            practice_id: practiceId,
            contact_id: contactMap.get(String(p.patient_id)) ?? null,
            amount_pence: toPence(p.amount),
            method: mapPaymentMethod(p.payment_method),
            status: mapPaymentStatus(p),
            processed_at: p.payment_date ?? p.paid_at ?? p.created_at ?? null,
        });
    }
    const synced = await upsertChunked('payments', rows, 'organisation_id,source,external_id');
    return { synced, skipped };
}

// ---- orchestration ----------------------------------------------------------

export async function syncOneOrg(orgId, integration) {
    const base = integration.config?.base_url ?? DEFAULT_BASE;
    const auth = authHeader(integration.secrets);
    if (!auth) {
        await integrationRepository.markFailed(orgId, 'dentally', 'no_auth: missing or undecryptable API key');
        return { error: 'no_auth' };
    }
    // Incremental cursor: changed-since last successful sync (default 30d on first run).
    const since = integration.last_sync_at ?? new Date(Date.now() - 30 * 86400000).toISOString();

    try {
        const siteMap = await loadSiteMap(orgId);
        // Patients first so appointment/payment contact resolution sees fresh ids.
        const patients = await pullPatients(orgId, base, auth, since, siteMap);
        const contactMap = await loadContactMap(orgId);
        const [appts, pays] = await Promise.all([
            pullAppointments(orgId, base, auth, since, siteMap, contactMap),
            pullPayments(orgId, base, auth, since, siteMap, contactMap),
        ]);
        await integrationRepository.upsert(orgId, 'dentally', {
            last_sync_at: new Date().toISOString(),
            last_error: null,
            status: 'active',
        });
        return {
            patients: patients.synced,
            appointments: appts.synced,
            payments: pays.synced,
            skipped_unmatched_practice: (appts.skipped ?? 0) + (pays.skipped ?? 0),
        };
    } catch (err) {
        await integrationRepository.markFailed(orgId, 'dentally', String(err.message).slice(0, 500));
        throw err;
    }
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
export const __test = { fetchAllPages, mapAppointmentStatus, mapPaymentStatus, mapPaymentMethod, toPence, authHeader };
