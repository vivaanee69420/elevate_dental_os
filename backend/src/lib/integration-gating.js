// ============================================================================
// Integration gating — "hide data while an integration is revoked".
//
// When an owner disconnects (revokes) an integration, the rows it synced must
// stop showing without deleting them (reconnect restores instantly). Reads
// consult these helpers to drop a revoked provider's data.
//
// Predicate semantics:
//   - A provider is REVOKED only if an integrations row exists with
//     status='revoked'. A provider that was NEVER connected has no row and is
//     NOT revoked — so an org's manual/CSV data (in shared, untagged tables) is
//     never hidden by an integration it never used.
//   - Source-tagged tables (payments.source, monthly_financials.source,
//     ad_metrics.provider) gate per-row precisely → manual rows always survive.
//   - Untagged tables (appointments / treatment_plans / invoice_items / leads)
//     can't tell a synced row from a manual one, so they hide WHOLESALE when
//     the owning domain is hidden: some provider in the domain is revoked AND
//     none is active (handles "switched from Dentally to SOE" — still active).
//
// Reads go through serviceClient (RLS bypassed), so orgId is the tenant guard.
// A short per-org cache keeps the extra lookup off the hot path; revoke/connect
// call invalidate(orgId) so a disconnect takes effect immediately.
// ============================================================================
import { integrationRepository } from "../repositories/integration.repository.js";

const TTL_MS = 30_000;
const cache = new Map(); // orgId -> { at, byProvider: Map<provider, status> }

async function load(orgId) {
    const hit = cache.get(orgId);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.byProvider;
    const rows = await integrationRepository.list(orgId);
    const list = Array.isArray(rows) ? rows : [];
    const byProvider = new Map(list.map((r) => [r.provider, r.status]));
    cache.set(orgId, { at: Date.now(), byProvider });
    return byProvider;
}

// Drop an org's cached snapshot — call after any status change (revoke/connect).
export function invalidate(orgId) {
    cache.delete(orgId);
}

export async function isRevoked(orgId, provider) {
    return (await load(orgId)).get(provider) === 'revoked';
}

export async function isActive(orgId, provider) {
    return (await load(orgId)).get(provider) === 'active';
}

// Set of providers currently status='revoked' (for ad_metrics row filtering).
export async function revokedProviders(orgId) {
    const byProvider = await load(orgId);
    const out = new Set();
    for (const [provider, status] of byProvider) if (status === 'revoked') out.add(provider);
    return out;
}

// Untagged-table rule: hide if some provider in the domain is revoked and none
// is active. Single-provider domains collapse to "revoked && not active".
export async function domainHidden(orgId, providers) {
    const byProvider = await load(orgId);
    let someRevoked = false;
    let someActive = false;
    for (const p of providers) {
        const s = byProvider.get(p);
        if (s === 'revoked') someRevoked = true;
        if (s === 'active') someActive = true;
    }
    return someRevoked && !someActive;
}

// Of the given candidate source values, return those whose provider is revoked
// (for source-tagged tables: payments / monthly_financials). e.g.
// revokedSources(org, ['dentally','quickbooks']) -> ['dentally'] when Dentally
// is disconnected. Source string === integration provider id for these tables.
export async function revokedSources(orgId, sources) {
    const byProvider = await load(orgId);
    return sources.filter((s) => byProvider.get(s) === 'revoked');
}

// --- Domain convenience wrappers -------------------------------------------
// Practice-management data lives in untagged tables (appointments,
// treatment_plans, invoice_items). dentally + soe are the PMS providers.
export function pmsHidden(orgId) {
    return domainHidden(orgId, ['dentally', 'soe']);
}

// CRM enquiries (leads) come from GoHighLevel. Single provider.
export function crmHidden(orgId) {
    return domainHidden(orgId, ['gohighlevel']);
}
