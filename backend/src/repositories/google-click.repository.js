// ============================================================================
// google_clicks — queries in, rows out. No logic (see CLAUDE.md's layering).
//
// The table accumulates and is never replaced, so there is no replaceWindow
// here and no delete: click_view retains 90 days, and a row we hold is the
// only copy that will ever exist. See migration 000177's header.
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";

export const googleClickRepository = {
    // Rows per statement. The same bound ad-grain uses, for the same reason:
    // a 90-day backfill is ~15k rows and one statement per row would be 15k
    // round trips.
    CHUNK_ROWS: 2000,

    /**
     * Insert clicks, ignoring any gclid already held. Returns the number of
     * NEW rows — not the number offered — so a caller can tell a real pull
     * from a re-pull of days it already had.
     */
    async insertChunk(orgId, rows) {
        if (!orgId) throw new Error('googleClickRepository.insertChunk: orgId required');
        if (!rows?.length) return 0;
        let inserted = 0;
        for (let i = 0; i < rows.length; i += this.CHUNK_ROWS) {
            const chunk = rows.slice(i, i + this.CHUNK_ROWS);
            const { data, error } = await supabase_1.serviceClient.rpc('google_clicks_upsert_chunk', {
                p_org: orgId, p_rows: chunk,
            });
            if (error) {
                throw new Error(`google_clicks_upsert_chunk (rows ${i}-${i + chunk.length} of ${rows.length}): ${error.message}`);
            }
            inserted += Number(data ?? 0);
        }
        return inserted;
    },

    /**
     * The newest click date held for one account, or null if none. This is how
     * the nightly run decides where to resume instead of re-walking 90 days.
     *
     * Per ACCOUNT, not per org: accounts are added at different times, and an
     * org-wide maximum would start a newly connected account at yesterday and
     * silently skip its backfill.
     */
    async latestClickDate(orgId, customerId) {
        const { data, error } = await supabase_1.serviceClient
            .from('google_clicks')
            .select('click_date')
            .eq('organisation_id', orgId)
            .eq('customer_id', String(customerId))
            .order('click_date', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (error) throw new Error(`google_clicks latestClickDate: ${error.message}`);
        return data?.click_date ?? null;
    },

    /** Coverage by campaign type, for the reconciliation panel. */
    async coverage(orgId, since, until) {
        const { data, error } = await supabase_1.serviceClient.rpc('google_clicks_coverage', {
            p_org: orgId, p_since: since, p_until: until,
        });
        if (error) throw new Error(`google_clicks_coverage: ${error.message}`);
        return data ?? [];
    },
};
