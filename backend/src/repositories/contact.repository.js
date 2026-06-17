// ============================================================================
// Contact repository — all Supabase data access for the contacts domain.
// No business logic here: queries in, rows out (or thrown DB error).
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";
export const contactRepository = {
    async list(orgId, q) {
        const limit = q.limit;
        const page = q.page ?? 1;
        const from = (page - 1) * limit;
        // count: 'exact' returns the total matching rows (for pagination) while
        // range() returns just this page.
        let query = supabase_1.serviceClient
            .from('contacts')
            .select('*, practice:practices(id, name)', { count: 'exact' })
            .eq('organisation_id', orgId)
            .order('updated_at', { ascending: false })
            .range(from, from + limit - 1);
        if (q.type)
            query = query.eq('type', q.type);
        if (q.practice_id)
            query = query.eq('practice_id', q.practice_id);
        if (q.integration_account_id)
            query = query.eq('integration_account_id', q.integration_account_id);
        if (q.source)
            query = query.eq('source', q.source);
        if (q.search) {
            // Strip PostgREST filter metacharacters so the value can't break out
            // of the intended ilike clauses and inject arbitrary filter operators.
            // ( ) , . \ " * are all reserved in the PostgREST query grammar.
            const s = q.search.replace(/[(),.\\"*]/g, ' ').slice(0, 80);
            query = query.or(`first_name.ilike.%${s}%,last_name.ilike.%${s}%,email.ilike.%${s}%,phone.ilike.%${s}%`);
        }
        const { data, error, count } = await query;
        if (error)
            throw new Error(error.message);
        return { rows: data ?? [], total: count ?? 0, page, limit };
    },
    async getById(orgId, id) {
        return supabase_1.serviceClient
            .from('contacts')
            .select('*, leads(*), communications(*), appointments(*), memberships(*)')
            .eq('id', id)
            .eq('organisation_id', orgId)
            .single();
    },
    async create(row) {
        return supabase_1.serviceClient.from('contacts').insert(row).select().single();
    },
    async update(orgId, id, patch) {
        return supabase_1.serviceClient
            .from('contacts')
            .update(patch)
            .eq('id', id)
            .eq('organisation_id', orgId)
            .select()
            .single();
    },
};
