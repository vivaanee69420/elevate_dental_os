// ============================================================================
// Payment repository — all Supabase data access for the payments domain.
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";
import { revokedSources } from "../lib/integration-gating.js";

// payments.source is the integration provider id ('dentally' | 'quickbooks');
// manual rows are 'manual' or null. A disconnected source's rows are hidden.
const PAYMENT_SOURCES = ['dentally', 'quickbooks'];

export const paymentRepository = {
    async list(orgId, q) {
        const limit = q.limit ?? 25;
        const page = q.page ?? 1;
        const from = (page - 1) * limit;
        const to = from + limit - 1;
        // Resolve gating first so the payments query stays the last query issued.
        const drop = await revokedSources(orgId, PAYMENT_SOURCES);
        let query = supabase_1.serviceClient
            .from('payments')
            .select('*, contact:contacts(id, first_name, last_name), practice:practices(id, name)', { count: 'exact' })
            .eq('organisation_id', orgId);
        // not.in drops the revoked sources; is.null keeps manual rows (NOT IN is
        // NULL for a null source, which would otherwise exclude them).
        if (drop.length) query = query.or(`source.is.null,source.not.in.(${drop.join(',')})`);
        if (q.status)
            query = query.eq('status', q.status);
        // Filter + order by processed_at (the REAL payment date). created_at is
        // the sync insert time (≈ today for a backfill) and must not drive dates.
        if (q.since)
            query = query.gte('processed_at', q.since);
        if (q.until)
            query = query.lte('processed_at', q.until);
        if (q.practice_id)
            query = query.eq('practice_id', q.practice_id);
        const { data, error, count } = await query
            .order('processed_at', { ascending: false, nullsFirst: false })
            .range(from, to);
        if (error)
            throw new Error(error.message);
        return { rows: data ?? [], total: count ?? (data?.length ?? 0) };
    },
    // Aggregate stats over ALL payments (not just the current page), so the
    // summary cards stay correct under pagination. settled = realised income.
    // Exact summary via RPC (no 1000-row cap), scoped to practice + date range.
    // received/refunded/count are range-scoped (processed_at); outstanding is
    // ALL pending for the practice (a running total).
    async summary(orgId, { practiceId = null, since = null, until = null } = {}) {
        const { data, error } = await supabase_1.serviceClient.rpc('payment_summary', {
            p_org: orgId,
            p_since: since ?? null,
            p_until: until ?? null,
            p_practice: practiceId ?? null,
            p_exclude_sources: await revokedSources(orgId, PAYMENT_SOURCES),
        });
        if (error)
            throw new Error(error.message);
        const row = (Array.isArray(data) ? data[0] : data) || {};
        return {
            received: Number(row.received_pence || 0),
            outstanding: Number(row.outstanding_pence || 0),
            refunded: Number(row.refunded_pence || 0),
            count: Number(row.txn_count || 0),
        };
    },
    async insertPending(row) {
        return supabase_1.serviceClient.from('payments').insert(row);
    },
    async insertManual(row) {
        const { data, error } = await supabase_1.serviceClient.from('payments').insert(row).select().single();
        if (error) throw new Error(error.message);
        return data;
    },
    async sourceBreakdown(orgId, since) {
        const drop = new Set(await revokedSources(orgId, PAYMENT_SOURCES));
        const { data, error } = await supabase_1.serviceClient
            .from('payments')
            .select('source, amount_pence, status')
            .eq('organisation_id', orgId)
            .gte('processed_at', since);
        if (error) throw new Error(error.message);
        const out = {};
        for (const p of (data ?? []).filter((r) => !drop.has(r.source))) {
            const k = p.source ?? 'manual';
            if (!out[k]) out[k] = { count: 0, pence: 0 };
            out[k].count++;
            if (p.status === 'settled' || p.status === 'processing') out[k].pence += p.amount_pence ?? 0;
        }
        return out;
    },
};
