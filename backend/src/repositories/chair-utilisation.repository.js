// ============================================================================
// Chair utilisation repository — Supabase data access. serviceClient bypasses
// RLS, so every query carries the explicit organisation_id tenant filter.
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";
import { pageAll } from "../lib/paged-select.js";

export const chairUtilisationRepository = {
    // Whole-org cell read for the analytics rollup. Paged, because a 50-chair
    // group is 1,400 rows and PostgREST truncates at 1000 without saying so.
    listAll(orgId) {
        return pageAll(() => supabase_1.serviceClient
            .from('chair_utilisation')
            .select('id, practice_id, chair_id, chair_name, weekday, slot, booked_minutes, revenue_pence')
            .eq('organisation_id', orgId));
    },

    // One chair's whole week in a single statement. The per-record API path
    // this replaces fired one POST -- and one full snapshot rewrite -- per
    // cell, so saving a 56-cell week meant 56 list-and-rewrite cycles.
    //
    // available_minutes is deliberately NOT written: capacity is derived from
    // practice_opening_hours, and storing a second copy would let the two
    // drift, which is the defect this rebuild exists to remove.
    async bulkUpsertChairWeek(orgId, { practice_id, chair_id, chair_name, cells }) {
        if (!cells?.length) return [];
        const payload = cells.map((c) => ({
            organisation_id: orgId,
            practice_id,
            chair_id,
            chair_name,
            weekday: Number(c.weekday),
            slot: c.slot,
            booked_minutes: Math.max(0, Number(c.booked_minutes) || 0),
            revenue_pence: Math.max(0, Number(c.revenue_pence) || 0),
            notes: c.notes ?? null,
        }));
        const { data, error } = await supabase_1.serviceClient
            .from('chair_utilisation')
            .upsert(payload, { onConflict: 'organisation_id,practice_id,chair_id,weekday,slot' })
            .select();
        if (error) throw new Error(error.message);
        return data ?? [];
    },

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
