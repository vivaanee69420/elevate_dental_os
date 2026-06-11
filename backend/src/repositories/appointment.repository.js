// ============================================================================
// Appointment repository — all Supabase data access for the appointments domain.
// No business logic here: queries in, rows out (or thrown DB error).
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";
import { pmsHidden } from "../lib/integration-gating.js";
export const appointmentRepository = {
    async list(orgId, q) {
        // PMS disconnected → its synced appointments are hidden (rule: untagged
        // table, wholesale hide while the PMS is revoked).
        if (await pmsHidden(orgId)) return { rows: [], total: 0 };
        const page = q.page ?? 1;
        const perPage = q.per_page ?? 25;
        const offset = (page - 1) * perPage;
        let query = supabase_1.serviceClient
            .from('appointments')
            .select('*, contact:contacts(id, first_name, last_name), associate:associates(id, full_name), practice:practices(id, name)', { count: 'exact' })
            .eq('organisation_id', orgId)
            .order('starts_at', { ascending: true });
        if (q.from)
            query = query.gte('starts_at', q.from);
        if (q.to)
            query = query.lte('starts_at', q.to);
        if (q.practice_id)
            query = query.eq('practice_id', q.practice_id);
        if (q.associate_id)
            query = query.eq('associate_id', q.associate_id);
        // Default: real patient appointments only (drop patient-less diary blocks
        // — lunch / not-working / nurse-cover / empty slots — which have no
        // pms_patient_id). patients_only=false includes them.
        if (q.patients_only !== 'false')
            query = query.not('pms_patient_id', 'is', null);
        query = query.range(offset, offset + perPage - 1);
        const { data, error, count } = await query;
        if (error)
            throw new Error(error.message);
        return { rows: data ?? [], total: count ?? 0 };
    },
    async create(row) {
        return supabase_1.serviceClient.from('appointments').insert(row).select().single();
    },
    async update(orgId, id, patch) {
        return supabase_1.serviceClient
            .from('appointments')
            .update(patch)
            .eq('id', id)
            .eq('organisation_id', orgId)
            .select()
            .single();
    },
};
