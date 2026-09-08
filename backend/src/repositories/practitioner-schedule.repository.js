// ============================================================================
// Practitioner schedules — queries in, rows out.
//
// The rota Dentally holds but does not publish (29 v1 paths probed, all 404;
// its NexGen API exists but needs credentials we do not have). Entered by the
// practice, one weekly pattern per practitioner per weekday, plus per-day
// overrides for exceptions — the same shape Dentally describes.
//
// MULTI-TENANCY: every statement carries an explicit
// .eq('organisation_id', orgId). These run on the service client, which
// bypasses RLS, so that filter IS the tenant boundary.
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";

const COLS = 'id, practitioner_id, weekday, start_min, end_min, break_min, effective_from, effective_to';
const OVERRIDE_COLS = 'id, practitioner_id, day, not_working, start_min, end_min, break_min, note';

export const practitionerScheduleRepository = {
    /** Every current weekly pattern for the org. Small by nature — one row per
     *  practitioner per weekday worked, ~135 for the largest org here. */
    async patterns(orgId) {
        const { data, error } = await supabase_1.serviceClient
            .from('practitioner_schedules')
            .select(COLS)
            .eq('organisation_id', orgId)
            .is('effective_to', null)
            .order('practitioner_id')
            .order('weekday');
        if (error) throw new Error(`practitioner_schedules: ${error.message}`);
        return data ?? [];
    },

    /** Overrides in a window. */
    async overrides(orgId, { since, until }) {
        const { data, error } = await supabase_1.serviceClient
            .from('practitioner_schedule_overrides')
            .select(OVERRIDE_COLS)
            .eq('organisation_id', orgId)
            .gte('day', since)
            .lte('day', until)
            .order('day');
        if (error) throw new Error(`practitioner_schedule_overrides: ${error.message}`);
        return data ?? [];
    },

    /** Replace one practitioner's whole week in one go.
     *
     *  Whole-week, not per-cell: the page edits a week as a unit, and a
     *  per-cell endpoint would leave a half-saved week if the browser dropped
     *  mid-save. Deleting the practitioner's current rows and inserting the
     *  new set makes the save idempotent and the result exactly what is on
     *  screen — a cleared day disappears rather than lingering because nothing
     *  was sent for it. */
    async saveWeek(orgId, practitionerId, days, userId) {
        const del = await supabase_1.serviceClient
            .from('practitioner_schedules')
            .delete()
            .eq('organisation_id', orgId)
            .eq('practitioner_id', practitionerId)
            .is('effective_to', null);
        if (del.error) throw new Error(`practitioner_schedules delete: ${del.error.message}`);

        if (!days.length) return [];

        const rows = days.map((d) => ({
            organisation_id: orgId,
            practitioner_id: practitionerId,
            weekday: d.weekday,
            start_min: d.startMin,
            end_min: d.endMin,
            break_min: d.breakMin ?? 0,
            updated_by: userId ?? null,
            updated_at: new Date().toISOString(),
        }));
        const { data, error } = await supabase_1.serviceClient
            .from('practitioner_schedules')
            .insert(rows)
            .select(COLS);
        if (error) throw new Error(`practitioner_schedules insert: ${error.message}`);
        return data ?? [];
    },

    /** Set or clear one day's override. */
    async saveOverride(orgId, practitionerId, day, patch, userId) {
        if (patch === null) {
            const { error } = await supabase_1.serviceClient
                .from('practitioner_schedule_overrides')
                .delete()
                .eq('organisation_id', orgId)
                .eq('practitioner_id', practitionerId)
                .eq('day', day);
            if (error) throw new Error(`override delete: ${error.message}`);
            return null;
        }
        const row = {
            organisation_id: orgId,
            practitioner_id: practitionerId,
            day,
            not_working: patch.notWorking ?? false,
            // A non-working day carries no hours at all. The table's CHECK
            // enforces this too; sending nulls keeps the two in step rather
            // than relying on the constraint to catch a bad payload.
            start_min: patch.notWorking ? null : patch.startMin,
            end_min: patch.notWorking ? null : patch.endMin,
            break_min: patch.notWorking ? 0 : (patch.breakMin ?? 0),
            note: patch.note ?? null,
            updated_by: userId ?? null,
            updated_at: new Date().toISOString(),
        };
        const { data, error } = await supabase_1.serviceClient
            .from('practitioner_schedule_overrides')
            .upsert(row, { onConflict: 'organisation_id,practitioner_id,day' })
            .select(OVERRIDE_COLS)
            .single();
        if (error) throw new Error(`override upsert: ${error.message}`);
        return data;
    },

    /** Scheduled minutes per practitioner per day, override beating pattern. */
    async scheduledMinutes(orgId, { since, until }) {
        const { data, error } = await supabase_1.serviceClient
            .rpc('practitioner_scheduled_minutes', { p_org: orgId, p_since: since, p_until: until });
        if (error) throw new Error(`practitioner_scheduled_minutes: ${error.message}`);
        return data ?? [];
    },
};
