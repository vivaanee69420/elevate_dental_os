// ============================================================================
// Practitioner utilisation — queries in, rows out.
//
// One RPC serves the whole screen (cards, the availability/usage chart and the
// per-practitioner grid) so the three cannot disagree about the same window.
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";

export const practitionerUtilisationRepository = {
    // Per practitioner per London day. Aggregated in SQL: a practice-week is
    // tens of thousands of appointments, and PostgREST truncates a plain read
    // at 1000 rows, so counting these in the browser would silently report a
    // fraction of the diary as the whole of it.
    async daily(orgId, { since, until, practiceId = null }) {
        const { data, error } = await supabase_1.serviceClient
            .rpc('practitioner_utilisation_daily', {
                p_org: orgId, p_since: since, p_until: until, p_practice: practiceId,
            });
        if (error) throw new Error(`practitioner_utilisation_daily: ${error.message}`);
        return data ?? [];
    },

    // Completed treatments per practitioner, aggregated in SQL. Keyed on
    // pms_practitioner_id so it joins to daily() above on the SAME identity -
    // attributing a clinician's chair time and their treatments through two
    // different keys would produce two plausible-looking rows for one person.
    //
    // DEGRADES rather than throws: an org synced before the treatment-items
    // phase existed has no rows, and a performance page that 500s because one
    // column is unavailable is worse than one that shows a dash for it. The
    // caller is told, so it can say so on screen.
    async treatmentsByPractitioner(orgId, { since, until, practiceId = null }) {
        const { data, error } = await supabase_1.serviceClient
            .rpc('treatments_completed_by_practitioner', {
                p_org: orgId, p_since: since, p_until: until, p_practice: practiceId,
            });
        if (error) {
            console.warn(`[practitioner] treatments_completed_by_practitioner unavailable: ${error.message}`);
            return null;
        }
        return data ?? [];
    },

    // The practice's most repeated treatments in the window. A SEPARATE read,
    // not derived from the per-practitioner tops above: the group's most
    // repeated treatment is not the most popular of each clinician's winners,
    // and summing winners would return a confident wrong answer.
    async topTreatments(orgId, { since, until, practiceId = null }) {
        const { data, error } = await supabase_1.serviceClient
            .rpc('treatments_top_by_org', {
                p_org: orgId, p_since: since, p_until: until, p_practice: practiceId,
            });
        if (error) {
            console.warn(`[practitioner] treatments_top_by_org unavailable: ${error.message}`);
            return null;
        }
        return data ?? [];
    },
};
