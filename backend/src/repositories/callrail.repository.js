// ============================================================================
// CallRail calls repository — the ONLY repository that touches
// callrail_calls (migration 20260101000154). Every CallRail COMPANY (its
// encrypted key, practice mapping, status) lives on integration_accounts and
// is read/written through integration-account.repository.js, reused as-is by
// callrail.service.js — this file never touches that table.
//
// MULTI-TENANT: serviceClient bypasses RLS, so the explicit organisation_id
// filter on every query IS the tenant boundary (rule 3) — never omit it.
//
// AGGREGATION: callCountsByAccount and sourceBreakdown both count in SQL, not
// in Node. callCountsByAccount is one bounded query PER company id the caller
// already knows about (from integration_accounts — never more than a handful
// per org), using the long-established `{ count: 'exact' }` + order+limit(1)
// pattern already used throughout this codebase (contact.repository.js,
// payment.repository.js, platform-admin.repository.js, ...) — so a company
// with a large call history is never paged into Node to be counted.
// sourceBreakdown has no such known key set (a CallRail company's `source`
// values aren't enumerable up front), so it groups+counts in one round trip
// using PostgREST's aggregate functions in `select` (`col.count()`, with an
// implicit GROUP BY on the remaining plain column) — stable and enabled by
// default since PostgREST v12.1 (Aug 2024); this project's Postgres 17
// toolchain is well past that version. This is the one genuinely new
// technique in this file (no other repository in the codebase uses it yet —
// see callrail.service.js's header for the flagged risk + fallback note).
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";

const TABLE = 'callrail_calls';
// Batch size for a bulk upsert. Not a response-row cap (PostgREST's 1000-row
// `max_rows` applies to reads, not writes) — just a sane chunk so one huge
// sync batch is never a single oversized request.
const UPSERT_CHUNK = 500;

export const callrailRepository = {
    // Indirection so tests can stub the client.
    _client() { return supabase_1.serviceClient; },

    // Idempotent on (organisation_id, callrail_id) — the DB unique constraint
    // from migration 000154. `rows` are plain objects shaped like
    // callrail_calls columns MINUS organisation_id, which is stamped here so
    // a caller can never write into another tenant by mistake. Chunked so a
    // large batch (a full historical pull) is several upserts, not one
    // oversized request or a per-row loop.
    async upsertCalls(orgId, rows) {
        const list = Array.isArray(rows) ? rows : [];
        if (list.length === 0) return { upserted: 0 };
        const stamped = list.map((r) => ({ ...r, organisation_id: orgId }));
        let upserted = 0;
        for (let i = 0; i < stamped.length; i += UPSERT_CHUNK) {
            const chunk = stamped.slice(i, i + UPSERT_CHUNK);
            const { data, error } = await this._client()
                .from(TABLE)
                .upsert(chunk, { onConflict: 'organisation_id,callrail_id' })
                .select('id');
            if (error) throw new Error(error.message);
            upserted += (data ?? chunk).length;
        }
        return { upserted };
    },

    // Call count + most recent call time per CallRail company, for the given
    // (already-fetched, org-scoped) integration_account ids. One org+company
    // scoped query per id — each is a `count(*)` plus an indexed
    // order-by-started_at-limit-1 (idx_callrail_calls_account backs both),
    // so cost is independent of how many calls that company has.
    async callCountsByAccount(orgId, accountIds) {
        const ids = [...new Set((accountIds ?? []).filter((id) => id != null))];
        const out = [];
        for (const id of ids) {
            const { data, error, count } = await this._client()
                .from(TABLE)
                .select('started_at', { count: 'exact' })
                .eq('organisation_id', orgId)
                .eq('integration_account_id', id)
                .order('started_at', { ascending: false })
                .limit(1);
            if (error) throw new Error(error.message);
            out.push({
                integrationAccountId: id,
                callCount: Number(count) || 0,
                lastCallAt: data?.[0]?.started_at ?? null,
            });
        }
        return out;
    },

    // What CallRail itself attributes each call to, grouped + counted in SQL,
    // org-wide (regardless of which company is still connected) — so the
    // "every tracked call is an ad call" assumption is checkable without
    // paging a tenant's whole call history into Node. See file header for the
    // PostgREST aggregate-select dependency this relies on.
    async sourceBreakdown(orgId) {
        const { data, error } = await this._client()
            .from(TABLE)
            .select('source, call_count:callrail_id.count()')
            .eq('organisation_id', orgId)
            .order('call_count', { ascending: false });
        if (error) throw new Error(error.message);
        return (data ?? []).map((r) => ({
            source: r.source ?? null,
            callCount: Number(r.call_count) || 0,
        }));
    },

    // A practice correction must take effect on history, not only on what
    // arrives next — practice_id is denormalised onto callrail_calls
    // (migration 000154's own rationale: a read should never need the join).
    // Scoped by BOTH organisation_id and integration_account_id, so this can
    // never restamp another company's — or another org's — calls.
    async restampPractice(orgId, integrationAccountId, practiceId) {
        const { error } = await this._client()
            .from(TABLE)
            .update({ practice_id: practiceId ?? null })
            .eq('organisation_id', orgId)
            .eq('integration_account_id', integrationAccountId);
        if (error) throw new Error(error.message);
    },
};
