// ============================================================================
// QuickBooks finance repository — read-only rollups for the Finance > QuickBooks
// dashboard. All queries carry organisation_id (serviceClient path, no RLS) and
// filter source='quickbooks'. An optional accountId scopes to a single connected
// company; omitted = every company summed. "queries in, rows out" — no shaping.
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";

function scope(q, orgId, accountId) {
    q = q.eq('organisation_id', orgId).eq('source', 'quickbooks');
    if (accountId) q = q.eq('integration_account_id', accountId);
    return q;
}

export const quickbooksFinanceRepository = {
    _client() { return supabase_1.serviceClient; },

    // monthly_financials rows for the period window (inclusive YYYY-MM bounds).
    async pnlRows(orgId, { accountId, fromPeriod, toPeriod }) {
        let q = this._client()
            .from('monthly_financials')
            .select('period, dental_bucket, amount_pence, integration_account_id');
        q = scope(q, orgId, accountId);
        if (fromPeriod) q = q.gte('period', fromPeriod);
        if (toPeriod) q = q.lte('period', toPeriod);
        const { data } = await q;
        return data ?? [];
    },

    // Current cash/bank balances (point-in-time snapshot, not windowed).
    async bankRows(orgId, { accountId }) {
        let q = this._client()
            .from('bank_accounts')
            .select('balance_pence, integration_account_id');
        q = scope(q, orgId, accountId);
        const { data } = await q;
        return data ?? [];
    },

    // Outstanding (unpaid) receivables, point-in-time.
    async receivableRows(orgId, { accountId }) {
        let q = this._client()
            .from('invoices')
            .select('amount_outstanding_pence, paid, integration_account_id')
            .eq('paid', false);
        q = scope(q, orgId, accountId);
        const { data } = await q;
        return data ?? [];
    },

    // Settled receipts within the date window (by processed_at).
    async receiptRows(orgId, { accountId, sinceIso, untilIso }) {
        let q = this._client()
            .from('payments')
            .select('amount_pence, processed_at, integration_account_id')
            .eq('status', 'settled');
        q = scope(q, orgId, accountId);
        if (sinceIso) q = q.gte('processed_at', sinceIso);
        if (untilIso) q = q.lte('processed_at', untilIso);
        const { data } = await q;
        return data ?? [];
    },

    // Active connected companies for the selector + per-company labels.
    async accounts(orgId) {
        const { data } = await this._client()
            .from('integration_accounts')
            .select('id, label, status, config')
            .eq('organisation_id', orgId)
            .eq('provider', 'quickbooks')
            .order('created_at', { ascending: true });
        return data ?? [];
    },
};
