// ============================================================================
// Per-practice opening hours -- the capacity source. serviceClient bypasses
// RLS, so the explicit .eq('organisation_id', orgId) IS the tenant isolation.
//
// Minutes from LOCAL midnight, never instants. A row with source='manual' is
// an owner's correction and the Dentally sync must never overwrite it.
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";
import { pageAll } from "../lib/paged-select.js";

const COLS = 'id, organisation_id, practice_id, weekday, open_minute, close_minute, source';

export const practiceOpeningHoursRepository = {
    async listForPractice(orgId, practiceId) {
        const { data, error } = await supabase_1.serviceClient
            .from('practice_opening_hours')
            .select(COLS)
            .eq('organisation_id', orgId)
            .eq('practice_id', practiceId)
            .order('weekday', { ascending: true });
        if (error) throw new Error(error.message);
        return data ?? [];
    },

    listAll(orgId) {
        return pageAll(() => supabase_1.serviceClient
            .from('practice_opening_hours')
            .select(COLS)
            .eq('organisation_id', orgId));
    },

    /** Weekdays an owner has hand-corrected. The sync reads this and leaves
     *  them alone -- a correction must survive every future sync. */
    async manualWeekdays(orgId, practiceId) {
        const { data, error } = await supabase_1.serviceClient
            .from('practice_opening_hours')
            .select('weekday')
            .eq('organisation_id', orgId)
            .eq('practice_id', practiceId)
            .eq('source', 'manual');
        if (error) throw new Error(error.message);
        return new Set((data ?? []).map((r) => Number(r.weekday)));
    },

    /** Upsert whole weekdays. `rows` are {weekday, openMinute, closeMinute}. */
    async upsertWeek(orgId, practiceId, rows, source) {
        if (!rows?.length) return [];
        const payload = rows.map((r) => ({
            organisation_id: orgId,
            practice_id: practiceId,
            weekday: Number(r.weekday),
            open_minute: r.openMinute ?? null,
            close_minute: r.closeMinute ?? null,
            source,
        }));
        const { data, error } = await supabase_1.serviceClient
            .from('practice_opening_hours')
            .upsert(payload, { onConflict: 'organisation_id,practice_id,weekday' })
            .select(COLS);
        if (error) throw new Error(error.message);
        return data ?? [];
    },
};
