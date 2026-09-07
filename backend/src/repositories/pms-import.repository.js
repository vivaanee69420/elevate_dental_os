// ============================================================================
// How much PMS-sourced data an organisation actually holds.
//
// The Integrations panel could say "Synced never" while a pull was several
// thousand rows in, because the only thing it read was integrations.last_sync_at
// — which is stamped once, on completion. A run that is halfway through, or one
// that died at 90%, looked identical to one that never started. These counts
// answer the question the owner is really asking: is anything here yet.
//
// Counts only — no row bodies are read, so nothing patient-identifying is
// loaded to render a number. Every query carries organisation_id (there is no
// RLS on the serviceClient path) and filters by source, so a tenant that has
// both Dentally and GoHighLevel contacts sees the Dentally figure on the
// Dentally tile rather than a combined total that matches neither.
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";

// Tables the PMS sync writes, and the column each one carries its origin in.
// `associates` and `practices` have no `source` column — they are provisioned
// from the PMS rather than imported from it — so they are counted org-wide.
const SOURCED = ['contacts', 'appointments', 'payments', 'invoices', 'treatment_plans'];
const UNSOURCED = ['associates', 'staff', 'practices'];

export const pmsImportRepository = {
    _client() { return supabase_1.serviceClient; },

    async _count(table, orgId, source) {
        let q = this._client()
            .from(table)
            .select('id', { count: 'exact', head: true })
            .eq('organisation_id', orgId);
        if (source) q = q.eq('source', source);
        const { count, error } = await q;
        // One missing table or a renamed column must not blank the whole panel:
        // a null reads as "not known" in the UI, where 0 would be a lie.
        if (error) return null;
        return count ?? 0;
    },

    /**
     * Row counts per resource for one organisation, plus the span the
     * appointments cover — the span is what tells an owner whether the history
     * they expected actually arrived, which a bare total cannot.
     */
    async summary(orgId, source = 'dentally') {
        const [sourced, unsourced] = await Promise.all([
            Promise.all(SOURCED.map((t) => this._count(t, orgId, source))),
            Promise.all(UNSOURCED.map((t) => this._count(t, orgId, null))),
        ]);
        const counts = {};
        SOURCED.forEach((t, i) => { counts[t] = sourced[i]; });
        UNSOURCED.forEach((t, i) => { counts[t] = unsourced[i]; });

        const [first, last] = await Promise.all([
            this._edgeAppointment(orgId, source, true),
            this._edgeAppointment(orgId, source, false),
        ]);
        return { counts, appointments_from: first, appointments_to: last };
    },

    // Earliest / latest appointment date. `starts_at` only — no patient columns.
    async _edgeAppointment(orgId, source, ascending) {
        const { data, error } = await this._client()
            .from('appointments')
            .select('starts_at')
            .eq('organisation_id', orgId)
            .eq('source', source)
            .order('starts_at', { ascending })
            .limit(1)
            .maybeSingle();
        if (error) return null;
        return data?.starts_at ?? null;
    },
};
