// ============================================================================
// Monthly financial repository — Supabase data access for monthly_financials.
// serviceClient bypasses RLS, so the explicit .eq('organisation_id', orgId) IS
// the only tenant guard on this path (see CLAUDE.md). Queries in, rows out.
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";

const LIMIT_GUARD = 5000;

export const monthlyFinancialRepository = {
    // Upsert one manual line. The composite-unique index
    // (org, period, account_code, COALESCE(practice_id,...), source) means
    // re-entering the same period+code+practice updates the amount in place
    // rather than duplicating. source is always 'manual' here.
    async upsertManual(orgId, { period, account_code, dental_bucket, amount_pence, practice_id }) {
        const row = {
            organisation_id: orgId,
            period,
            account_code: account_code ?? dental_bucket,
            dental_bucket,
            amount_pence,
            practice_id: practice_id ?? null,
            source: 'manual',
        };
        const { error } = await supabase_1.serviceClient
            .from('monthly_financials')
            .upsert(row, { onConflict: 'organisation_id,period,account_code,practice_id,source' });
        if (error) throw new Error(error.message);
        return row;
    },
    async list(orgId, { from, to, practice_id } = {}) {
        let q = supabase_1.serviceClient
            .from('monthly_financials')
            .select('id, period, account_code, dental_bucket, amount_pence, practice_id, source, updated_at')
            .eq('organisation_id', orgId);
        if (from) q = q.gte('period', from);
        if (to) q = q.lte('period', to);
        if (practice_id) q = q.eq('practice_id', practice_id);
        const { data, error } = await q.order('period', { ascending: false }).limit(LIMIT_GUARD);
        if (error) throw new Error(error.message);
        return data || [];
    },
    // All rows for an org (both 'manual' and 'xero'/'quickbooks'), for the
    // analytics read path. Source is selected so the reader can apply the
    // Xero-overrides-manual precedence per period+bucket.
    async allForOrg(orgId) {
        const { data, error } = await supabase_1.serviceClient
            .from('monthly_financials')
            .select('period, dental_bucket, amount_pence, source, practice_id')
            .eq('organisation_id', orgId)
            .limit(LIMIT_GUARD);
        if (error) throw new Error(error.message);
        return Array.isArray(data) ? data : [];
    },
    async remove(orgId, id) {
        const { error } = await supabase_1.serviceClient
            .from('monthly_financials')
            .delete()
            .eq('id', id)
            .eq('organisation_id', orgId)
            .eq('source', 'manual'); // only manual rows are user-deletable
        if (error) throw new Error(error.message);
    },
};
