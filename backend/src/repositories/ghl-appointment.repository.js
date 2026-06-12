// ============================================================================
// GHL appointments repository — calendar bookings pulled from GoHighLevel,
// stored separate from the clinical `appointments` table. Org-scoped writes.
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";

export const ghlAppointmentRepository = {
    _client() { return supabase_1.serviceClient; },

    // Bulk upsert appointment rows (already org-stamped) keyed on (organisation_id, ghl_event_id).
    async upsertMany(rows) {
        if (!rows || rows.length === 0) return 0;
        const { error } = await this._client()
            .from('ghl_appointments')
            .upsert(rows, { onConflict: 'organisation_id,ghl_event_id' });
        if (error) throw new Error(error.message);
        return rows.length;
    },
};
