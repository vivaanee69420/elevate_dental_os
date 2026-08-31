// ============================================================================
// Cross-tenant write guards (isolation audit, phase A4).
//
// Repos run on serviceClient, which BYPASSES RLS — isolation is only ever as
// good as the filters and the values we agree to write. Two holes this closes:
//
//  1. stripImmutable — a freeform PATCH body could carry `organisation_id`.
//     The WHERE was org-scoped (so you could only select your OWN row) but the
//     SET was not, so a tenant could push one of its rows INTO another org.
//
//  2. assertOrgOwns — a body-supplied FK (contact_id, practice_id, plan_id,
//     assigned_to, lead_id) was written without checking it belongs to the
//     caller. That matters more than it looks: PostgREST embedded resources
//     (`contact:contacts(...)`) resolve the FK as a join under serviceClient
//     with NO org predicate of its own, so a stored foreign id becomes a
//     cross-org PII read on the next list call. Validating on the way IN is
//     the single choke point that closes the whole class.
// ============================================================================
import { serviceClient } from './supabase.js';
import { AppError } from '../middleware/errors.js';

// Row identity + tenancy: never patchable by a request body.
export const IMMUTABLE_ROW_KEYS = ['organisation_id', 'id', 'created_at'];

export function stripImmutable(patch) {
    const out = { ...(patch || {}) };
    for (const k of IMMUTABLE_ROW_KEYS) delete out[k];
    return out;
}

// Throws unless `id` exists in `table` AND belongs to `orgId`. Null/undefined
// passes (the FK is optional). A foreign id 404s exactly like a missing one, so
// this is not an existence oracle for other tenants' data.
export async function assertOrgOwns(orgId, table, id, label = 'Record') {
    if (id === null || id === undefined || id === '') return;
    const { data, error } = await serviceClient
        .from(table)
        .select('id')
        .eq('id', id)
        .eq('organisation_id', orgId)
        .maybeSingle();
    // Fail CLOSED: a lookup failure must not wave the write through.
    if (error) throw new AppError(`Could not validate ${label.toLowerCase()}`, 500);
    if (!data) throw new AppError(`${label} not found in your organisation`, 404);
}
