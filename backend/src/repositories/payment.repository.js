// ============================================================================
// Payment repository — all Supabase data access for the payments domain.
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";
export const paymentRepository = {
    async list(orgId, q) {
        let query = supabase_1.serviceClient
            .from('payments')
            .select('*, contact:contacts(id, first_name, last_name), practice:practices(id, name)')
            .eq('organisation_id', orgId)
            .order('created_at', { ascending: false })
            .limit(200);
        if (q.status)
            query = query.eq('status', q.status);
        if (q.since)
            query = query.gte('created_at', q.since);
        const { data, error } = await query;
        if (error)
            throw new Error(error.message);
        return data;
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
