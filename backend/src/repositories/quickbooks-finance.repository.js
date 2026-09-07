// ============================================================================
// QuickBooks finance repository — read-only rollups for the Finance > QuickBooks
// dashboard and the Business Hub QuickBooks block. All queries carry
// organisation_id (serviceClient path, no RLS) and filter source='quickbooks'.
// An optional accountId scopes to a single connected company; omitted = every
// company summed. "queries in, rows out" — no shaping.
//
// Every unbounded read here is PAGED, and it must be. `.limit()` does NOT lift
// PostgREST's server-side db-max-rows ceiling — the server truncates at 1,000
// and reports no error. Measured on the live database (four connected
// companies): the DEFAULT view — trailing twelve months, all companies, accrual
// — needs 1,214 monthly_financials rows. Revenue read £4,669,274.15 against a
// true £5,282,486.91, and net profit read HIGHER than the truth (£866,928.79 vs
// £841,724.43) because the rows that fell off the end were net-negative. With
// no ORDER BY, *which* rows survived was arbitrary as well.
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";

const PAGE = 1000;
// A hard bound so a server that never returns an empty page cannot hang the
// request or exhaust memory. 500 pages is 500k rows — orders of magnitude above
// any real org's ledger, so it can only trip on a fault, never on real data.
const MAX_PAGES = 500;

function scope(q, orgId, accountId) {
    q = q.eq('organisation_id', orgId).eq('source', 'quickbooks');
    if (accountId) q = q.eq('integration_account_id', accountId);
    return q;
}

// Read a whole table window a page at a time. `build()` returns a FRESH query on
// every call: a Supabase builder accumulates its modifiers, so reusing one
// instance would send two .order()s and two .range()s on the second page.
async function readAll(build) {
    const rows = [];
    for (let offset = 0, pages = 0; pages < MAX_PAGES; pages++) {
        const { data, error } = await build()
            .order('id', { ascending: true })
            .range(offset, offset + PAGE - 1);
        if (error) throw new Error(error.message);
        const page = Array.isArray(data) ? data : [];
        rows.push(...page);
        // Stop on an EMPTY page, never a short one: the server's ceiling is its
        // own setting, so treating a short page as the last would reintroduce
        // this truncation at whatever that number happens to be.
        if (page.length === 0) break;
        offset += page.length;
    }
    return rows;
}

export const quickbooksFinanceRepository = {
    _client() { return supabase_1.serviceClient; },

    // monthly_financials rows for the period window (inclusive YYYY-MM bounds).
    // QuickBooks P&L is synced under BOTH accounting_method='accrual' and 'cash'
    // (see quickbooks-sync.js) — callers MUST pin one method or revenue/expenses
    // double-count. Defaults to accrual (standard P&L basis); legacy null-method
    // rows are folded into accrual so pre-column data is not silently dropped.
    async pnlRows(orgId, { accountId, fromPeriod, toPeriod, accountingMethod = 'accrual' }) {
        return readAll(() => {
            let q = this._client()
                .from('monthly_financials')
                .select('id, period, dental_bucket, amount_pence, integration_account_id');
            q = scope(q, orgId, accountId);
            if (accountingMethod === 'accrual') q = q.or('accounting_method.eq.accrual,accounting_method.is.null');
            else q = q.eq('accounting_method', accountingMethod);
            if (fromPeriod) q = q.gte('period', fromPeriod);
            if (toPeriod) q = q.lte('period', toPeriod);
            return q;
        });
    },

    // Current cash/bank balances (point-in-time snapshot — the latest live sync).
    async bankRows(orgId, { accountId }) {
        return readAll(() => scope(
            this._client().from('bank_accounts').select('id, balance_pence, integration_account_id'),
            orgId, accountId,
        ));
    },

    // Month-end cash balances for a single period ('YYYY-MM'). Powers the
    // period-aware "Cash at Bank" tile (cash as-of the end of the selected
    // window). Empty when the period predates the snapshot history → caller
    // falls back to the live bankRows snapshot.
    async bankSnapshotRows(orgId, { accountId, period }) {
        if (!period) return [];
        return readAll(() => scope(
            this._client().from('bank_balance_snapshots')
                .select('id, balance_pence, integration_account_id')
                .eq('period', period),
            orgId, accountId,
        ));
    },

    // Outstanding (unpaid) receivables, point-in-time.
    async receivableRows(orgId, { accountId }) {
        return readAll(() => scope(
            this._client().from('invoices')
                .select('id, amount_outstanding_pence, paid, integration_account_id')
                .eq('paid', false),
            orgId, accountId,
        ));
    },

    // Settled receipts within the date window (by processed_at).
    async receiptRows(orgId, { accountId, sinceIso, untilIso }) {
        return readAll(() => {
            let q = this._client()
                .from('payments')
                .select('id, amount_pence, processed_at, integration_account_id')
                .eq('status', 'settled');
            q = scope(q, orgId, accountId);
            if (sinceIso) q = q.gte('processed_at', sinceIso);
            if (untilIso) q = q.lte('processed_at', untilIso);
            return q;
        });
    },

    // Active connected companies for the selector + per-company labels. Bounded
    // by how many QuickBooks companies an org connects (single digits), so this
    // one read needs no paging.
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
