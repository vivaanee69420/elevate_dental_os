// ============================================================================
// Appointment repository — all Supabase data access for the appointments domain.
// No business logic here: queries in, rows out (or thrown DB error).
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";
import { pmsHidden } from "../lib/integration-gating.js";
// Patient search runs through the appointments_search RPC (migration 000147)
// rather than a PostgREST embed filter. An embed filter plans as a nested loop
// over the org's appointments probing contacts by primary key — 1,473ms for one
// page of 25 on the largest org. The RPC filters contacts FIRST, off a trigram
// index, and semi-joins: 20ms for the same page.
//
// It also deliberately ignores from/to. A search is "find this patient's
// appointments", not "find them inside the window I am looking at", so
// searching from the Upcoming view must not hide their past visits. Results
// come back newest-first (the unsearched list is oldest-first) because with no
// date bounds, ascending would open on the patient's oldest ever appointment.
//
// The RPC returns each row shaped exactly like the PostgREST embed below, so
// both paths hand the client the same object.
async function searchByPatient(orgId, q, perPage, offset) {
    const { data, error } = await supabase_1.serviceClient.rpc('appointments_search', {
        p_org: orgId,
        p_term: q.search,
        p_practice: q.practice_id ?? null,
        p_associate: q.associate_id ?? null,
        p_patients_only: q.patients_only !== 'false',
        p_limit: perPage,
        p_offset: offset,
    });
    if (error)
        throw new Error(error.message);
    const rows = data ?? [];
    // total rides on every row (count(*) OVER ()), so an empty page carries no
    // total. Unreachable from the UI, which resets to page 1 on every filter and
    // search change; an out-of-range offset simply reads as an empty result.
    return { rows: rows.map((r) => r.appointment), total: Number(rows[0]?.total ?? 0) };
}
export const appointmentRepository = {
    async list(orgId, q) {
        // PMS disconnected → its synced appointments are hidden (rule: untagged
        // table, wholesale hide while the PMS is revoked).
        if (await pmsHidden(orgId)) return { rows: [], total: 0 };
        const page = q.page ?? 1;
        const perPage = q.per_page ?? 25;
        const offset = (page - 1) * perPage;
        if (q.search)
            return searchByPatient(orgId, q, perPage, offset);
        let query = supabase_1.serviceClient
            .from('appointments')
            // email/phone are selected on both paths so the shapes match: the UI
            // shows them in a Contact column while a search is active, which is
            // the only way to see WHY a row matched an email or phone search.
            .select('*, contact:contacts(id, first_name, last_name, email, phone), associate:associates(id, full_name), practice:practices(id, name)', { count: 'exact' })
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
