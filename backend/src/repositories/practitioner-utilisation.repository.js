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
};
