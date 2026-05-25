// ============================================================================
// Payment repository — all Supabase data access for the payments domain.
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";
export const paymentRepository = {
    async list(orgId, q) {
        const limit = q.limit ?? 25;
        const page = q.page ?? 1;
        const from = (page - 1) * limit;
        const to = from + limit - 1;
        let query = supabase_1.serviceClient
            .from('payments')
            .select('*, contact:contacts(id, first_name, last_name), practice:practices(id, name)', { count: 'exact' })
            .eq('organisation_id', orgId);
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
    async summary(orgId, practiceId) {
        let query = supabase_1.serviceClient
            .from('payments')
            .select('amount_pence, status, processed_at, created_at')
            .eq('organisation_id', orgId);
        if (practiceId)
            query = query.eq('practice_id', practiceId);
        const { data, error } = await query.limit(20000);
        if (error)
            throw new Error(error.message);
        const now = Date.now();
        const within = (iso, ms) => iso && now - new Date(iso).getTime() <= ms;
        const out = { today: 0, week: 0, month: 0, outstanding: 0 };
        for (const p of data ?? []) {
            const when = p.processed_at ?? p.created_at;
            if (p.status === 'settled') {
                if (within(when, 86400000)) out.today += p.amount_pence || 0;
                if (within(when, 7 * 86400000)) out.week += p.amount_pence || 0;
                if (within(when, 30 * 86400000)) out.month += p.amount_pence || 0;
            } else if (p.status === 'pending') {
                out.outstanding += p.amount_pence || 0;
            }
        }
        return out;
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
        const { data, error } = await supabase_1.serviceClient
            .from('payments')
            .select('source, amount_pence, status')
            .eq('organisation_id', orgId)
            .gte('processed_at', since);
        if (error) throw new Error(error.message);
        const out = {};
        for (const p of data ?? []) {
            const k = p.source ?? 'manual';
            if (!out[k]) out[k] = { count: 0, pence: 0 };
            out[k].count++;
            if (p.status === 'settled' || p.status === 'processing') out[k].pence += p.amount_pence ?? 0;
        }
        return out;
    },
};
