// ============================================================================
// Chair utilisation repository — Supabase data access. serviceClient bypasses
// RLS, so every query carries the explicit organisation_id tenant filter.
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";

export const chairUtilisationRepository = {
    async list(orgId, practiceId) {
        let query = supabase_1.serviceClient
            .from('chair_utilisation')
            .select('*')
            .eq('organisation_id', orgId)
            .order('chair_name', { ascending: true })
            .order('weekday', { ascending: true });
        if (practiceId) query = query.eq('practice_id', practiceId);
        const { data, error } = await query;
        if (error) throw new Error(error.message);
        return data ?? [];
    },

    async create(row) {
        return supabase_1.serviceClient.from('chair_utilisation').insert(row).select().single();
    },

    async update(orgId, id, patch) {
        return supabase_1.serviceClient
            .from('chair_utilisation')
            .update(patch)
            .eq('id', id)
            .eq('organisation_id', orgId)
            .select()
            .maybeSingle();
    },

    async remove(orgId, id) {
        return supabase_1.serviceClient
            .from('chair_utilisation')
            .delete()
            .eq('id', id)
            .eq('organisation_id', orgId)
            .select('id, practice_id')
            .maybeSingle();
    },

    // --- History (000055) ----------------------------------------------------
    // Write/refresh today's per-practice grid snapshot. Read-modify-write so a
    // same-day re-save updates the one row (unique org+practice+date).
    async upsertSnapshot(orgId, practiceId, dateStr, cells) {
        const { data: existing } = await supabase_1.serviceClient
            .from('chair_utilisation_snapshots')
            .select('id')
            .eq('organisation_id', orgId)
            .eq('practice_id', practiceId)
            .eq('snapshot_date', dateStr)
            .maybeSingle();
        if (existing) {
            const { error } = await supabase_1.serviceClient
                .from('chair_utilisation_snapshots')
                .update({ cells })
                .eq('id', existing.id)
                .eq('organisation_id', orgId);
            if (error) throw new Error(error.message);
        } else {
            const { error } = await supabase_1.serviceClient
                .from('chair_utilisation_snapshots')
                .insert({ organisation_id: orgId, practice_id: practiceId, snapshot_date: dateStr, cells });
            if (error) throw new Error(error.message);
        }
        return cells;
    },

    // Latest per-practice grid effective on/before `dateStr` (as-of read).
    async getSnapshotAsOf(orgId, practiceId, dateStr) {
        const { data } = await supabase_1.serviceClient
            .from('chair_utilisation_snapshots')
            .select('cells')
            .eq('organisation_id', orgId)
            .eq('practice_id', practiceId)
            .lte('snapshot_date', dateStr)
            .order('snapshot_date', { ascending: false })
            .limit(1)
            .maybeSingle();
        return data?.cells || null;
    },
};
