// ============================================================================
// Debt repository — Supabase data access for the debt domain. Returns unpaid
// invoice rows with contact + practice names joined. Org isolation is manual
// (serviceClient path) — the explicit .eq('organisation_id', orgId) is required.
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";
export const debtRepository = {
    async listUnpaid(orgId, { practiceId = null } = {}) {
        let query = supabase_1.serviceClient
            .from('invoices')
            .select('id, amount_outstanding_pence, dated_on, due_on, treatment, patient_name, practice:practices(name), contact:contacts(first_name, last_name)')
            .eq('organisation_id', orgId)
            // outstanding > 0 == debt. Use gte(...,1) — amount is integer pence,
            // and the test harness models gte (not gt).
            .gte('amount_outstanding_pence', 1);
        if (practiceId) query = query.eq('practice_id', practiceId);
        const { data, error } = await query.order('due_on', { ascending: true, nullsFirst: true });
        if (error) throw new Error(error.message);
        return data ?? [];
    },
};
