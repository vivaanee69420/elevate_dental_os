// backend/src/repositories/data-room.repository.js
// ============================================================================
// Data Room repository — generic, registry-driven reads. "Queries in, rows
// out." Tenant isolation: serviceClient path, so EVERY query carries an
// explicit .eq('organisation_id', orgId) (rule 3). The registry never lists
// organisation_id; it is applied here, unconditionally.
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";
import { columnNames } from "../lib/data-room/registry.js";

/** London calendar date (YYYY-MM-DD) of an ISO instant — for `date` columns. */
function londonDate(iso) {
    return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
}

function bound(ds, iso) {
    return ds.dateType === 'date' ? londonDate(iso) : new Date(iso).toISOString();
}

/** Static registry predicates: eq, or `{ not: null }` -> IS NOT NULL. */
function applyWhere(q, where) {
    for (const [col, val] of Object.entries(where || {})) {
        if (val && typeof val === 'object' && 'not' in val && val.not === null) q = q.not(col, 'is', null);
        else q = q.eq(col, val);
    }
    return q;
}

/** org + static where + practice + date window — shared by page() and count(). */
function applyFilters(q, orgId, ds, filters) {
    q = q.eq('organisation_id', orgId);
    q = applyWhere(q, ds.where);
    if (ds.practice.col) {
        if (filters.practiceId) q = q.eq(ds.practice.col, filters.practiceId);
    } else if (filters.practiceKeys) {
        q = q.in(ds.practice.via.col, filters.practiceKeys);
    }
    if (ds.dateCol && filters.since) q = q.gte(ds.dateCol, bound(ds, filters.since));
    if (ds.dateCol && filters.until) q = q.lt(ds.dateCol, bound(ds, filters.until));
    return q;
}

// PostgREST `or=` values are double-quoted so ISO timestamps (':' '+') and
// uuids pass through verbatim.
const quoted = (v) => `"${String(v).replace(/"/g, '')}"`;

export const dataRoomRepository = {
    /**
     * One page. Two modes over the same filters + (dateCol, id) ordering:
     *   keyset — `after` = { d, id } from the previous page's last row (null
     *            for the first page); O(page) on any table size (CSV export).
     *   offset — `offset` (numbered pages in the UI): `.range(offset,
     *            offset+limit-1)`; `after` is ignored.
     * Rows carry only `columns` (default: every registry column — the
     * service narrows for PII).
     */
    async page(orgId, ds, filters, { after, offset, limit, columns }) {
        const select = (columns || columnNames(ds, true)).join(',');
        const byOffset = offset != null;
        let q = supabase_1.serviceClient.from(ds.table).select(select);
        q = applyFilters(q, orgId, ds, filters);
        if (ds.dateCol) {
            if (after && !byOffset) {
                q = q.or(`${ds.dateCol}.gt.${quoted(after.d)},and(${ds.dateCol}.eq.${quoted(after.d)},id.gt.${quoted(after.id)})`);
            }
            q = q.order(ds.dateCol, { ascending: true }).order('id', { ascending: true });
        } else {
            if (after && !byOffset) q = q.gt('id', after.id);
            q = q.order('id', { ascending: true });
        }
        const { data, error } = await (byOffset ? q.range(offset, offset + limit - 1) : q.limit(limit));
        if (error) throw new Error(error.message);
        return data ?? [];
    },

    /** Exact row count for the same filters (HEAD request, no rows). */
    async count(orgId, ds, filters) {
        let q = supabase_1.serviceClient.from(ds.table).select('id', { count: 'exact', head: true });
        q = applyFilters(q, orgId, ds, filters);
        const { count, error } = await q;
        if (error) throw new Error(error.message);
        return count ?? 0;
    },

    /** Parent keys for a `practice.via` dataset: via.key values mapped to the practice. */
    async viaKeys(orgId, via, practiceId) {
        let q = supabase_1.serviceClient.from(via.table).select(via.key)
            .eq('organisation_id', orgId)
            .eq('practice_id', practiceId);
        q = applyWhere(q, via.where);
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        return (data ?? []).map((r) => r[via.key]).filter((v) => v != null);
    },

    /** GHL pipelines flattened from integration_accounts.config — one row per stage. */
    async pipelineRows(orgId, practiceId) {
        let q = supabase_1.serviceClient.from('integration_accounts').select('id,practice_id,config')
            .eq('organisation_id', orgId)
            .eq('provider', 'gohighlevel');
        if (practiceId) q = q.eq('practice_id', practiceId);
        const { data, error } = await q.order('id', { ascending: true });
        if (error) throw new Error(error.message);
        const rows = [];
        for (const acc of data ?? []) {
            for (const p of acc.config?.pipelines ?? []) {
                const stages = Array.isArray(p.stages) && p.stages.length ? p.stages : [null];
                for (const s of stages) {
                    rows.push({
                        integration_account_id: acc.id,
                        practice_id: acc.practice_id ?? null,
                        pipeline_id: p.id ?? null,
                        pipeline_name: p.name ?? null,
                        stage_id: s?.id ?? null,
                        stage_name: s?.name ?? null,
                    });
                }
            }
        }
        return rows;
    },

    /** Explicit audit row — the audit middleware only logs mutations. */
    async logExport(orgId, userId, diff, { ip, userAgent }) {
        const { error } = await supabase_1.serviceClient.from('audit_log').insert({
            organisation_id: orgId,
            user_id: userId,
            action: 'export',
            entity_type: 'data_room',
            diff,
            ip_address: ip ?? null,
            user_agent: userAgent ?? null,
        });
        if (error) throw new Error(error.message);
    },
};
