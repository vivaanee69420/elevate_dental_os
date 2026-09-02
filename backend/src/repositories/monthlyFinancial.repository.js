// ============================================================================
// Monthly financial repository — Supabase data access for monthly_financials.
// serviceClient bypasses RLS, so the explicit .eq('organisation_id', orgId) IS
// the only tenant guard on this path (see CLAUDE.md). Queries in, rows out.
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";
import { revokedSources } from "../lib/integration-gating.js";

const LIMIT_GUARD = 5000;
// monthly_financials.source = integration provider id for synced lines
// ('xero' | 'quickbooks'); 'manual' rows are owner-entered. Disconnecting an
// accounting integration hides its imported lines, never the manual ones.
const FINANCE_SOURCES = ['xero', 'quickbooks'];

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
        const drop = new Set(await revokedSources(orgId, FINANCE_SOURCES));
        // Paged for the same reason as allForOrg: `.limit()` does NOT lift
        // PostgREST's server-side ceiling, so an org with more rows than that
        // ceiling silently loses the tail of its ledger. `period` alone is not
        // unique, so id breaks the tie and keeps OFFSET paging sound.
        //
        // The query is rebuilt on every page rather than reused: a Supabase
        // builder accumulates its modifiers, so calling .order()/.range() on the
        // same instance twice sends two of each.
        const PAGE = 1000;
        const MAX_PAGES = 500;   // see allForOrg: a bound against a faulty server
        const rows = [];
        for (let offset = 0, pages = 0; pages < MAX_PAGES; pages++) {
            let q = supabase_1.serviceClient
                .from('monthly_financials')
                .select('id, period, account_code, dental_bucket, amount_pence, practice_id, source, updated_at')
                .eq('organisation_id', orgId);
            if (from) q = q.gte('period', from);
            if (to) q = q.lte('period', to);
            if (practice_id) q = q.eq('practice_id', practice_id);
            const { data, error } = await q
                .order('period', { ascending: false })
                .order('id', { ascending: true })
                .range(offset, offset + PAGE - 1);
            if (error) throw new Error(error.message);
            const page = Array.isArray(data) ? data : [];
            rows.push(...page);
            // Stop on an EMPTY page, never a short one.
            if (page.length === 0) break;
            offset += page.length;
        }
        return rows.filter((r) => !drop.has(r.source));
    },
    // All rows for an org (both 'manual' and 'xero'/'quickbooks'), for the
    // analytics read path. Source is selected so the reader can apply the
    // Xero-overrides-manual precedence per period+bucket. Optional filters scope
    // the read to one provider (source) and/or one connected company
    // (accountId = integration_account_id) — used by the /profit source toggle.
    // accounting_method is selected so the service layer can split cash vs accrual.
    async allForOrg(orgId, { source = null, accountId = null } = {}) {
        const drop = new Set(await revokedSources(orgId, FINANCE_SOURCES));
        // PAGED, and it must be. `.limit(5000)` does NOT lift PostgREST's own
        // db-max-rows ceiling — the server truncates at 1000 and says nothing.
        // Measured on the live database: this org holds 3,064 rows and the API
        // returned exactly 1,000, so two thirds of every cost was silently
        // discarded. Cash out for August read £207,200 against a true £299,071,
        // and because the read carried no ORDER BY, *which* rows survived was
        // arbitrary — every finance screen built on this bundle (cashflow,
        // runway, P&L, margin, benchmark) was wrong by a different amount each
        // month. Ordering by id makes the paging sound as well as the totals.
        const PAGE = 1000;
        // A hard bound so a server that never returns an empty page cannot hang
        // the request or exhaust memory. 500 pages is 500k rows — orders of
        // magnitude above any real org's ledger, so it can only ever trip on a
        // fault, never on legitimate data.
        const MAX_PAGES = 500;
        const rows = [];
        for (let from = 0, pages = 0; pages < MAX_PAGES; pages++) {
            let q = supabase_1.serviceClient
                .from('monthly_financials')
                .select('period, account_code, dental_bucket, amount_pence, source, practice_id, integration_account_id, accounting_method, id')
                .eq('organisation_id', orgId)
                .order('id', { ascending: true })
                .range(from, from + PAGE - 1);
            if (source) q = q.eq('source', source);
            if (accountId) q = q.eq('integration_account_id', accountId);
            const { data, error } = await q;
            if (error) throw new Error(error.message);
            const page = Array.isArray(data) ? data : [];
            rows.push(...page);
            // Stop on an EMPTY page, never a short one: the server's cap is its
            // own setting, so treating a short page as the last reintroduces
            // this very truncation at whatever number that cap happens to be.
            if (page.length === 0) break;
            from += page.length;
        }
        return rows.filter((r) => !drop.has(r.source));
    },
    // Distinct cost-data sources present for an org (e.g. ['quickbooks'] or
    // ['xero','manual']), revoked providers excluded. Cheap — used to name the
    // cash-out feed on the cashflow card. Capped read; the source vocabulary is
    // tiny so a sample reliably captures every distinct value in practice.
    async distinctSources(orgId) {
        const drop = new Set(await revokedSources(orgId, FINANCE_SOURCES));
        const { data, error } = await supabase_1.serviceClient
            .from('monthly_financials')
            .select('source')
            .eq('organisation_id', orgId)
            .limit(LIMIT_GUARD);
        if (error) throw new Error(error.message);
        return [...new Set((Array.isArray(data) ? data : []).map((r) => r.source).filter((s) => s && !drop.has(s)))];
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
