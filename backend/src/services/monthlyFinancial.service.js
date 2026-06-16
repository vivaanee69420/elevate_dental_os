// ============================================================================
// Monthly financial service — manual P&L actuals entry + the shared read-path
// helpers the analytics service uses to surface actuals on the finance screens.
//
// Precedence (decided with the product owner): for the same period + bucket,
// synced accounting actuals (Xero/QuickBooks) OVERRIDE manual entries. Manual
// is the fallback when no synced row exists for that period+bucket. See
// bucketsByPeriod().
//
// Bucket mapping is documented in docs/FORMULAS.md.
// ============================================================================
import * as monthlyFinancial_repository_1 from "../repositories/monthlyFinancial.repository.js";

const SYNCED_SOURCES = new Set(['xero', 'quickbooks']);

// Collapse monthly_financials rows into Map<period, {revenue,staff,lab,...}> in
// pence. For each period+bucket: if any synced (Xero/QuickBooks) row exists, use
// the sum of synced rows and ignore manual rows for that bucket; else use the
// sum of manual rows. Pure — exported for the analytics read path + tests.
export function bucketsByPeriod(rows, { accountingMethod = 'accrual' } = {}) {
    const acc = new Map(); // period -> bucket -> { synced, manual, hasSynced }
    for (const r of Array.isArray(rows) ? rows : []) {
        if (!r.period || !r.dental_bucket) continue;
        // Accounting basis: rows carry accounting_method ('accrual'|'cash'); rows
        // predating the column (or manual/xero) are treated as accrual. Cash basis
        // surfaces ONLY explicit cash rows (the QB cash pull).
        const rowMethod = r.accounting_method || 'accrual';
        if (rowMethod !== accountingMethod) continue;
        if (!acc.has(r.period)) acc.set(r.period, {});
        const byBucket = acc.get(r.period);
        const cell = byBucket[r.dental_bucket] ||
            (byBucket[r.dental_bucket] = { synced: 0, manual: 0, hasSynced: false });
        const amt = r.amount_pence || 0;
        if (SYNCED_SOURCES.has(r.source)) { cell.synced += amt; cell.hasSynced = true; }
        else { cell.manual += amt; }
    }
    const out = new Map();
    for (const [period, byBucket] of acc) {
        const resolved = {};
        for (const [bucket, cell] of Object.entries(byBucket)) {
            resolved[bucket] = cell.hasSynced ? cell.synced : cell.manual;
        }
        out.set(period, resolved);
    }
    return out;
}

// Like bucketsByPeriod, but keeps per-account_code line detail so a P&L bucket
// can be expanded into the individual accounts that roll into it (e.g. the
// 'overhead' bucket -> Council Tax, Advertising, Utilities...). Applies the SAME
// synced-overrides-manual precedence per period+bucket: when any synced
// (Xero/QuickBooks) row exists for a period+bucket, manual account lines for
// that period+bucket are dropped. Returns Map<period, Map<bucket, Map<code,
// amount_pence>>>. account_code falls back to dental_bucket for legacy rows.
// Pure — exported for the analytics read path + tests.
export function accountLinesByPeriod(rows, { accountingMethod = 'accrual' } = {}) {
    const list = Array.isArray(rows) ? rows : [];
    const same = (r) => (r.accounting_method || 'accrual') === accountingMethod;
    // Decide, per period+bucket, whether synced rows exist (precedence gate).
    const hasSynced = new Map(); // period -> Set(bucket)
    for (const r of list) {
        if (!r.period || !r.dental_bucket || !same(r)) continue;
        if (!SYNCED_SOURCES.has(r.source)) continue;
        if (!hasSynced.has(r.period)) hasSynced.set(r.period, new Set());
        hasSynced.get(r.period).add(r.dental_bucket);
    }
    const out = new Map();
    for (const r of list) {
        if (!r.period || !r.dental_bucket || !same(r)) continue;
        const bucketSynced = hasSynced.get(r.period)?.has(r.dental_bucket);
        if (bucketSynced && !SYNCED_SOURCES.has(r.source)) continue; // manual loses
        const code = r.account_code || r.dental_bucket;
        if (!out.has(r.period)) out.set(r.period, new Map());
        const byBucket = out.get(r.period);
        if (!byBucket.has(r.dental_bucket)) byBucket.set(r.dental_bucket, new Map());
        const byCode = byBucket.get(r.dental_bucket);
        byCode.set(code, (byCode.get(code) || 0) + (r.amount_pence || 0));
    }
    return out;
}

// Sum resolved buckets for the periods a [from,to] day-range covers. period keys
// are 'YYYY-MM'; endpoints are compared at month granularity (inclusive on both
// ends). Pure — the dashboard read path uses this to slice actuals to a custom
// range instead of collapsing costs/profit to zero. Exported for tests.
export function sumBucketsInWindow(byPeriod, fromYmd, toYmd) {
    const lo = (fromYmd || '').slice(0, 7);
    const hi = (toYmd || '').slice(0, 7);
    const out = {};
    const entries = byPeriod instanceof Map ? byPeriod.entries() : Object.entries(byPeriod || {});
    for (const [period, buckets] of entries) {
        if (lo && period < lo) continue;
        if (hi && period > hi) continue;
        for (const [k, v] of Object.entries(buckets)) out[k] = (out[k] || 0) + v;
    }
    return out;
}

// Map a resolved bucket set -> { revenue, costs } shaped for formulas.calculatePL.
// 'associates' is fee-earning clinician pay split out of the ledger by the sync
// heuristic (account names like "Associate/Principal salary", "hygienist") — 0
// when the org's chart of accounts doesn't name them separately. 'property'/
// 'marketing' have no dedicated actuals bucket (they live inside 'overhead'), and
// 'tax' is below the operating line so it is excluded from operating costs —
// matching the baseline P&L which has no tax cost line. Documented in docs/FORMULAS.md.
export function plInputFromBuckets(b = {}) {
    return {
        revenue: b.revenue || 0,
        costs: {
            associates: b.associates || 0,
            staff: b.staff || 0,
            lab: b.lab || 0,
            materials: b.materials || 0,
            property: 0,
            marketing: 0,
            other: (b.overhead || 0) + (b.other || 0),
        },
    };
}

// Map a resolved bucket set -> the /profit finance-series month grouping.
export function financeSeriesRowFromBuckets(month, b = {}) {
    const revenue = b.revenue || 0;
    const associatePay = b.associates || 0;
    const staffCosts = b.staff || 0;
    const labMaterials = (b.lab || 0) + (b.materials || 0);
    const opex = (b.overhead || 0) + (b.other || 0);
    return {
        month,
        revenue,
        associatePay,
        staffCosts,
        labMaterials,
        opex,
        profit: revenue - associatePay - staffCosts - labMaterials - opex,
    };
}

export const monthlyFinancialService = {
    async createManual(orgId, input) {
        return monthlyFinancial_repository_1.monthlyFinancialRepository.upsertManual(orgId, input);
    },
    async list(orgId, query) {
        const rows = await monthlyFinancial_repository_1.monthlyFinancialRepository.list(orgId, query);
        return { rows };
    },
    async remove(orgId, id) {
        await monthlyFinancial_repository_1.monthlyFinancialRepository.remove(orgId, id);
        return { ok: true };
    },
};
