// ============================================================================
// Contact repository — all Supabase data access for the contacts domain.
// No business logic here: queries in, rows out (or thrown DB error).
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";
export const contactRepository = {
    async list(orgId, q) {
        let query = supabase_1.serviceClient
            .from('contacts')
            .select('*, practice:practices(id, name)')
            .eq('organisation_id', orgId)
            .order('updated_at', { ascending: false })
            .limit(q.limit);
        if (q.type)
            query = query.eq('type', q.type);
        if (q.practice_id)
            query = query.eq('practice_id', q.practice_id);
        if (q.search) {
            query = query.or(`first_name.ilike.%${q.search}%,last_name.ilike.%${q.search}%,email.ilike.%${q.search}%,phone.ilike.%${q.search}%`);
        }
        const { data, error } = await query;
        if (error)
            throw new Error(error.message);
        return data;
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
