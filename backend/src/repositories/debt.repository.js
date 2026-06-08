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
    // Settled receipts in [sinceISO, now) -> "Recovered" total. Real money
    // collected (QuickBooks/Xero/Stripe payments), summed in pence. Caller
    // passes a trailing-12-month sinceISO. practiceId scopes to one practice.
    async settledSince(orgId, sinceISO, { practiceId = null } = {}) {
        let query = supabase_1.serviceClient
            .from('payments')
            .select('amount_pence')
            .eq('organisation_id', orgId)
            .eq('status', 'settled')
            .gte('processed_at', sinceISO)
            .limit(50000);
        if (practiceId) query = query.eq('practice_id', practiceId);
        const { data, error } = await query;
        if (error) throw new Error(error.message);
        return (data ?? []).reduce((s, p) => s + (p.amount_pence ?? 0), 0);
    },
};
