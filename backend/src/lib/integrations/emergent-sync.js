// ============================================================================
// Emergent connector — pulls "treatment accepted" records staff log in the
// Emergent ops app into Dental-os. See treatmentaccepted.md.
//
// SCAFFOLD / BLOCKED: the live ingest is blocked on Emergent returning their API
// contract (base URL + key, webhook secret + signature header, exact JSON field
// names, patient link key, status enum). `mapRecord` is implemented + testable;
// `syncOrg`/`syncAllOrgs` are skeletons gated off until the contract lands and
// the integration is connected. Do NOT wire a cron to these yet.
//
// Follows existing connector patterns (Dentally/GHL): secrets encrypted via
// crypto.js, webhook routed by per-org token, repo uses serviceClient + explicit
// organisation_id filter, money stored as integer pence.
// ============================================================================
import { treatmentAcceptedRepository } from "../../repositories/treatment-accepted.repository.js";

// Map one Emergent record to a treatment_accepted row. Money: value_gbp -> pence
// (rounded). Field names below assume the documented shape — adjust on Emergent's
// confirmation (treatmentaccepted.md "Assumed record shape").
export function mapRecord(rec, orgId) {
    return {
        organisation_id: orgId,
        source: 'emergent',
        external_id: String(rec.id),
        patient_name: rec.patient_name ?? null,
        patient_external_id: rec.patient_external_id != null ? String(rec.patient_external_id) : null,
        practitioner_name: rec.practitioner_name ?? null,
        treatment_name: rec.treatment_name ?? null,
        value_pence: Math.round(Number(rec.value_gbp || 0) * 100),
        accepted_date: rec.accepted_date ?? null,
        status: rec.status ?? null,
        raw: rec,
        // contact_id / practice_id / associate_id resolved best-effort by the
        // caller (patient_external_id / practice_name / practitioner_name) once
        // the patient link key is confirmed; null until then.
    };
}

// Pull loop — BLOCKED until Emergent's API contract is available. Skeleton kept
// so the wiring is ready: load the encrypted emergent integration config, page
// GET {base_url}/api/treatment-accepted?updated_after=...&cursor=... with the
// X-API-Key header, mapRecord -> upsert, advance last_synced_at.
export async function syncOrg(_orgId) {
    throw new Error('emergent-sync: blocked on Emergent API contract (see treatmentaccepted.md)');
}

// Worker entry — fan out over orgs with an active emergent integration. No-op
// until syncOrg is unblocked; safe to leave unwired.
export async function syncAllOrgs() {
    return { synced: 0, skipped: 'emergent integration not yet available' };
}

export { treatmentAcceptedRepository };
