// ============================================================================
// Emergent connector — pulls "treatment accepted" records staff log in the
// Emergent ops app into Dental-os. See treatmentaccepted.md.
//
// LIVE. Wired against the real Emergent public API:
//   GET {base_url}/api/public/treatments-accepted?start_date=YYYY-MM-DD
//   header: X-API-Key: <key>
//   -> { count, manager_reported_count, rows: [...], sheets: [...] }
//
// Row shape (no record id, no status field — endpoint only ever returns
// accepted treatments, so every mapped row is status='accepted'):
//   business_id, business_name, date (YYYY-MM-DD), patient_name,
//   treatment_accepted, quantity (always 1), amount (float GBP), source,
//   campaign, dentist, comments
//
// Follows existing connector patterns (Dentally/GHL): secrets encrypted via
// crypto.js, repo uses serviceClient + explicit organisation_id filter, money
// stored as integer pence.
// ============================================================================
import crypto from "node:crypto";
import * as supabase_1 from "../supabase.js";
import { decryptSecret } from "../crypto.js";
import { integrationRepository } from "../../repositories/integration.repository.js";
import { treatmentAcceptedRepository } from "../../repositories/treatment-accepted.repository.js";
import { emergentPracticeMapRepository } from "../../repositories/emergent-practice-map.repository.js";

const PROVIDER = 'emergent';
const ENDPOINT = '/api/public/treatments-accepted';

// Emergent records carry no stable id, so we derive a deterministic external_id
// from the immutable fields. Re-pulling the same record yields the same key, so
// the upsert on (organisation_id, source, external_id) stays idempotent — no
// double counting. Trade-off: two genuinely distinct rows with identical
// business/date/patient/treatment/amount collapse to one (rare; acceptable).
export function externalId(rec) {
    const parts = [rec.business_id, rec.date, rec.patient_name, rec.treatment_accepted, rec.amount]
        .map((x) => (x == null ? '' : String(x)))
        .join('|');
    return crypto.createHash('sha256').update(parts).digest('hex').slice(0, 32);
}

// Decimal pounds -> integer pence (rule 2). null/undefined/'' -> 0.
export function poundsToPence(x) {
    return Math.round(Number(x || 0) * 100);
}

// Shared practice resolution: explicit map (by business_id) wins even when its
// value is null (owner intentionally unmapped); otherwise fuzzy business_name.
export function resolvePracticeFromMaps(businessId, businessName, maps = null) {
    const explicit = maps && maps.explicit instanceof Map ? maps.explicit : null;
    const fuzzy = maps instanceof Map ? maps : (maps && maps.fuzzy instanceof Map ? maps.fuzzy : null);
    if (explicit && explicit.has(String(businessId))) return explicit.get(String(businessId));
    if (fuzzy) return resolvePractice(businessName, fuzzy);
    return null;
}

// Map one Emergent record to a treatment_accepted row. Money: amount (float GBP)
// -> integer pence. status is forced to 'accepted'. practice_id resolution:
//   - `maps` may be a { explicit: Map<business_id, practice_id|null>, fuzzy: Map }
//     object (new) OR a legacy plain Map (fuzzy only, back-compat).
//   - An explicit row ALWAYS wins, even when its practice_id is null (the owner
//     intentionally left it unmapped) — we then do NOT fall back to fuzzy.
//   - Otherwise fall back to the fuzzy business_name match.
export function mapRecord(rec, orgId, maps = null) {
    const empty = (s) => (s == null || String(s).trim() === '' ? null : String(s));
    const practiceId = resolvePracticeFromMaps(rec.business_id, rec.business_name, maps);
    return {
        organisation_id: orgId,
        source: PROVIDER,
        external_id: externalId(rec),
        business_id: rec.business_id == null ? null : String(rec.business_id),
        patient_name: empty(rec.patient_name),
        patient_external_id: null,
        practice_id: practiceId,
        practitioner_name: empty(rec.dentist),
        treatment_name: empty(rec.treatment_accepted),
        value_pence: Math.round(Number(rec.amount || 0) * 100),
        accepted_date: rec.date ?? null,
        status: 'accepted',
        raw: rec,
        quantity: rec.quantity == null ? 1 : Number(rec.quantity),
        phone: empty(rec.phone),
        email: empty(rec.email),
        ext_source: empty(rec.source),
        ext_campaign: empty(rec.campaign),
    };
}

const KNOWN_SOURCES = [
    'google', 'facebook', 'walk_in', 'friends_family', 'wl_website',
    'dentist_referral', 'instagram', 'youtube', 'other',
];

export function cashupExternalId(data) {
    return `${data.business_id}_${data.date}`;
}

// Map one daily_cashup payload -> { row (emergent_daily_cashup), patients
// (treatment_accepted rows via mapRecord) }. Money -> pence. Known source_*
// keys become typed columns; anything else lands in custom_sources.
export function mapCashup(data, orgId, maps = null) {
    const empty = (s) => (s == null || String(s).trim() === '' ? null : String(s));
    const practiceId = resolvePracticeFromMaps(data.business_id, data.business_name, maps);

    const sourceCols = {
        source_google: 0, source_facebook: 0, source_walk_in: 0, source_friends_family: 0,
        source_wl_website: 0, source_dentist_referral: 0, source_instagram: 0,
        source_youtube: 0, source_other: 0,
    };
    const custom_sources = {};
    for (const [k, v] of Object.entries(data)) {
        const m = /^source_(.+)$/.exec(k);
        if (!m) continue;
        const key = m[1];
        if (KNOWN_SOURCES.includes(key)) sourceCols[`source_${key}`] = Number(v || 0);
        else custom_sources[key] = Number(v || 0);
    }

    const refunds = Array.isArray(data.refunds)
        ? data.refunds.map((r) => ({
            amount_pence: poundsToPence(r.amount),
            reason: r.reason ?? null,
            patient_name: r.patient_name ?? null,
        }))
        : [];

    const row = {
        organisation_id: orgId,
        business_id: data.business_id == null ? null : String(data.business_id),
        business_name: empty(data.business_name),
        practice_id: practiceId,
        cashup_date: data.date ?? null,
        external_id: cashupExternalId(data),
        treatments_accepted: Number(data.treatments_accepted ?? data.num_treatment_accepted ?? 0),
        tx_plans_given: Number(data.tx_plans_given || 0),
        tx_plan_given_value_pence: poundsToPence(data.total_tx_plan_given_value),
        cash_up_money_taken_pence: poundsToPence(data.cash_up_money_taken),
        num_bookings: Number(data.num_bookings || 0),
        num_new_leads: Number(data.num_new_leads || 0),
        num_follow_ups: Number(data.num_follow_ups || 0),
        num_attended: Number(data.num_attended || 0),
        total_chairs: Number(data.total_chairs || 0),
        chairs_used: Number(data.chairs_used || 0),
        chair_utilisation: data.chair_utilisation == null ? null : Number(data.chair_utilisation),
        reviews_collected: Number(data.reviews_collected || 0),
        before_after_pictures: Number(data.before_after_pictures || 0),
        video_testimonials: Number(data.video_testimonials || 0),
        practice_plan_signups: Number(data.practice_plan_signups || 0),
        total_refunds_pence: poundsToPence(data.total_refunds),
        ...sourceCols,
        custom_sources,
        refunds,
        appointment_booked_for: empty(data.appointment_booked_for),
        crm_system_notes: empty(data.crm_system_notes),
        detail_patient_rows_count: Number(data.detail_patient_rows_count || 0),
        detail_patient_money_total_pence: poundsToPence(data.detail_patient_money_total),
        variance_manager_vs_detail: data.variance_manager_vs_detail == null ? null : Number(data.variance_manager_vs_detail),
        emergent_created_at: data.created_at ?? null,
        emergent_created_by: data.created_by == null ? null : String(data.created_by),
        raw: data,
    };

    const patients = Array.isArray(data.patients)
        ? data.patients.map((p) => mapRecord(
            { ...p, business_id: data.business_id, business_name: data.business_name, date: data.date },
            orgId, maps,
        ))
        : [];

    return { row, patients };
}

// Resolve an Emergent business_name to a practices.id. Emergent uses a short
// name ("Ashford") while the practice record is the full trading name
// ("GM Dental & Implant Centre Ashford"), so match by substring both ways
// (case-insensitive). Null when nothing matches or the match is ambiguous —
// the row still counts in org-level totals, just not per-practice.
function resolvePractice(businessName, practiceMap) {
    const needle = (businessName || '').trim().toLowerCase();
    if (!needle) return null;
    const hits = [];
    for (const [name, id] of practiceMap) {
        if (name.includes(needle) || needle.includes(name)) hits.push(id);
    }
    return hits.length === 1 ? hits[0] : null;
}

// { practices.name(lower) -> practices.id } for an org.
async function loadPracticeMap(orgId) {
    const { data } = await supabase_1.serviceClient
        .from('practices')
        .select('id, name')
        .eq('organisation_id', orgId);
    const map = new Map();
    for (const p of data ?? []) if (p.name) map.set(String(p.name).trim().toLowerCase(), p.id);
    return map;
}

// Build the full resolution input for mapRecord: the explicit map-table entries
// plus the legacy fuzzy practices-by-name map (fallback). Both org-scoped.
export async function loadResolution(orgId) {
    const [explicit, fuzzy] = await Promise.all([
        emergentPracticeMapRepository.resolutionMap(orgId),
        loadPracticeMap(orgId),
    ]);
    return { explicit, fuzzy };
}

// Call the Emergent API for all accepted treatments since startDate (YYYY-MM-DD).
// Throws on non-2xx (401 -> bad/expired key) so the caller can markFailed.
async function fetchRecords(baseUrl, apiKey, startDate) {
    const url = `${baseUrl.replace(/\/+$/, '')}${ENDPOINT}?start_date=${encodeURIComponent(startDate)}`;
    const res = await fetch(url, { headers: { 'X-API-Key': apiKey, Accept: 'application/json' } });
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Emergent API ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = await res.json();
    return Array.isArray(json?.rows) ? json.rows : [];
}

// Validate a base URL + key by hitting the endpoint once (cheap, today's date).
// Returns true on 2xx; throws with a readable message on 401/other.
export async function verifyCredentials(baseUrl, apiKey) {
    await fetchRecords(baseUrl, apiKey, new Date().toISOString().slice(0, 10));
    return true;
}

// Pull accepted treatments for one org and upsert them. `full` widens the window
// to all-time; incremental re-pulls a trailing window (the endpoint returns
// everything since start_date and upserts are idempotent, so an overlap just
// re-confirms recent rows and catches late edits).
export async function syncOrg(orgId, { full = false } = {}) {
    const row = await integrationRepository.getByProvider(orgId, PROVIDER);
    if (!row || row.status !== 'active') return { synced: 0, skipped: 'not connected' };

    const baseUrl = row.config?.base_url;
    if (!baseUrl) return { synced: 0, skipped: 'no base url' };
    let apiKey;
    try {
        apiKey = JSON.parse(decryptSecret(row.secrets) || '{}').apiKey;
    } catch {
        apiKey = null;
    }
    if (!apiKey) return { synced: 0, skipped: 'no api key' };

    // Window policy: a manual `full` pull is all-time; the automatic path does a
    // 1-year first fill (no prior sync) then a trailing 6-month nightly window
    // (cheap overlap that re-confirms recent rows and catches late edits).
    const firstFill = !row.last_sync_at;
    const startDate = full
        ? '2020-01-01'
        : firstFill
            ? new Date(Date.now() - 365 * 86400_000).toISOString().slice(0, 10)
            : new Date(Date.now() - 183 * 86400_000).toISOString().slice(0, 10);

    try {
        const [records, maps] = await Promise.all([
            fetchRecords(baseUrl, apiKey, startDate),
            loadResolution(orgId),
        ]);
        await emergentPracticeMapRepository.discover(
            orgId,
            records.map((r) => ({ business_id: r.business_id, business_name: r.business_name })),
        );
        let synced = 0;
        for (const rec of records) {
            await treatmentAcceptedRepository.upsert(mapRecord(rec, orgId, maps));
            synced += 1;
        }
        await integrationRepository.setSyncTime(orgId, PROVIDER);
        return { synced };
    } catch (err) {
        await integrationRepository.markFailed(orgId, PROVIDER, err.message).catch(() => {});
        throw err;
    }
}

// Worker entry — fan out over every org with an active emergent integration.
export async function syncAllOrgs() {
    const { data } = await supabase_1.serviceClient
        .from('integrations')
        .select('organisation_id')
        .eq('provider', PROVIDER)
        .eq('status', 'active');
    const results = [];
    for (const { organisation_id: orgId } of data ?? []) {
        try {
            results.push({ orgId, ...(await syncOrg(orgId)) });
        } catch (err) {
            results.push({ orgId, error: err.message });
        }
    }
    return results;
}

export { treatmentAcceptedRepository };
