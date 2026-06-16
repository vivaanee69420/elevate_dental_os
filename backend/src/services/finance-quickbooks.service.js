// ============================================================================
// Finance > QuickBooks service — shapes the per-company / summed dashboard
// payload from the quickbooks-finance repository. All *_pence are integer pence.
//
// Revenue  = monthly_financials dental_bucket='revenue'
// Expenses = every other bucket (staff/lab/materials/overhead/tax/other)
// Net      = revenue - expenses ; margin% = net / revenue
// Cash / receivables are point-in-time snapshots; receipts are windowed.
// ============================================================================
import { quickbooksFinanceRepository } from "../repositories/quickbooks-finance.repository.js";

const EXPENSE_BUCKETS = ['associates', 'staff', 'lab', 'materials', 'overhead', 'tax', 'other'];
const ALL_BUCKETS = ['revenue', ...EXPENSE_BUCKETS];

// Enumerate inclusive YYYY-MM periods between two YYYY-MM bounds (cap 24).
function periodsBetween(fromPeriod, toPeriod) {
    const out = [];
    let [y, m] = fromPeriod.split('-').map(Number);
    const [ty, tm] = toPeriod.split('-').map(Number);
    for (let guard = 0; guard < 24; guard++) {
        const p = `${y}-${String(m).padStart(2, '0')}`;
        out.push(p);
        if (y === ty && m === tm) break;
        m += 1;
        if (m > 12) { m = 1; y += 1; }
    }
    return out;
}

function thisPeriod() {
    const now = new Date();
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

function shiftPeriod(period, deltaMonths) {
    let [y, m] = period.split('-').map(Number);
    m += deltaMonths;
    while (m < 1) { m += 12; y -= 1; }
    while (m > 12) { m -= 12; y += 1; }
    return `${y}-${String(m).padStart(2, '0')}`;
}

// Normalise the query into a YYYY-MM window. `period` pins a single month;
// otherwise from/to (date or month) bound it; default = trailing 12 months.
function resolveWindow({ period, from, to }) {
    if (period) return { fromPeriod: period, toPeriod: period };
    const toP = to ? String(to).slice(0, 7) : thisPeriod();
    const fromP = from ? String(from).slice(0, 7) : shiftPeriod(toP, -11);
    return { fromPeriod: fromP, toPeriod: toP };
}

function sumPence(rows, key) {
    return rows.reduce((acc, r) => acc + (Number(r[key]) || 0), 0);
}

function bucketTotals(pnlRows) {
    const out = Object.fromEntries(ALL_BUCKETS.map((b) => [b, 0]));
    for (const r of pnlRows) {
        const b = ALL_BUCKETS.includes(r.dental_bucket) ? r.dental_bucket : 'other';
        out[b] += Number(r.amount_pence) || 0;
    }
    return out;
}

function summarise(pnlRows) {
    const byBucket = bucketTotals(pnlRows);
    const revenuePence = byBucket.revenue;
    const expensesPence = EXPENSE_BUCKETS.reduce((acc, b) => acc + byBucket[b], 0);
    const netProfitPence = revenuePence - expensesPence;
    const netMarginPct = revenuePence > 0 ? Math.round((netProfitPence / revenuePence) * 1000) / 10 : 0;
    return { byBucket, revenuePence, expensesPence, netProfitPence, netMarginPct };
}

export const financeQuickbooksService = {
    async getOverview(orgId, { accountId = null, period = null, from = null, to = null, accountingMethod = 'accrual' } = {}) {
        const method = accountingMethod === 'cash' ? 'cash' : 'accrual';
        const { fromPeriod, toPeriod } = resolveWindow({ period, from, to });
        const sinceIso = new Date(`${fromPeriod}-01T00:00:00Z`).toISOString();
        // end of the toPeriod month
        const [ey, em] = toPeriod.split('-').map(Number);
        const untilIso = new Date(Date.UTC(ey, em, 0, 23, 59, 59)).toISOString();

        const [pnlRows, bankRows, bankSnapRows, receivableRows, receiptRows, accountRows] = await Promise.all([
            quickbooksFinanceRepository.pnlRows(orgId, { accountId, fromPeriod, toPeriod, accountingMethod: method }),
            quickbooksFinanceRepository.bankRows(orgId, { accountId }),
            quickbooksFinanceRepository.bankSnapshotRows(orgId, { accountId, period: toPeriod }),
            quickbooksFinanceRepository.receivableRows(orgId, { accountId }),
            quickbooksFinanceRepository.receiptRows(orgId, { accountId, sinceIso, untilIso }),
            quickbooksFinanceRepository.accounts(orgId),
        ]);

        const base = summarise(pnlRows);
        // Cash AS OF the end of the selected window (month-end snapshot). Falls
        // back to the live bank_accounts snapshot when no history exists yet for
        // that period (pre-backfill, or before the next sync runs).
        const useSnapshot = bankSnapRows.length > 0;
        const cashSource = useSnapshot ? bankSnapRows : bankRows;
        const cashAtBankPence = sumPence(cashSource, 'balance_pence');
        const cashAsOf = useSnapshot ? toPeriod : 'latest';
        const receivablesPence = sumPence(receivableRows, 'amount_outstanding_pence');
        const receiptsPence = sumPence(receiptRows, 'amount_pence');

        // Per-period trend (revenue/expenses/profit) across the window.
        const periods = periodsBetween(fromPeriod, toPeriod);
        const byPeriod = new Map(periods.map((p) => [p, []]));
        for (const r of pnlRows) { if (byPeriod.has(r.period)) byPeriod.get(r.period).push(r); }
        const trend = periods.map((p) => {
            const s = summarise(byPeriod.get(p) ?? []);
            return { period: p, revenuePence: s.revenuePence, expensesPence: s.expensesPence, netProfitPence: s.netProfitPence };
        });

        // Per-company breakdown (only meaningful in the "All companies" view).
        const labelOf = new Map(accountRows.map((a) => [a.id, a.config?.company_name ?? a.label ?? 'QuickBooks']));
        const companies = [];
        if (!accountId) {
            const groups = new Map();
            for (const r of pnlRows) {
                const k = r.integration_account_id ?? 'unknown';
                if (!groups.has(k)) groups.set(k, []);
                groups.get(k).push(r);
            }
            const cashByAcc = groupSum(cashSource, 'balance_pence');
            const recvByAcc = groupSum(receivableRows, 'amount_outstanding_pence');
            const rcptByAcc = groupSum(receiptRows, 'amount_pence');
            for (const [accId, rows] of groups) {
                const s = summarise(rows);
                companies.push({
                    accountId: accId,
                    companyName: labelOf.get(accId) ?? 'QuickBooks',
                    revenuePence: s.revenuePence,
                    expensesPence: s.expensesPence,
                    netProfitPence: s.netProfitPence,
                    netMarginPct: s.netMarginPct,
                    cashAtBankPence: cashByAcc.get(accId) ?? 0,
                    receivablesPence: recvByAcc.get(accId) ?? 0,
                    receiptsPence: rcptByAcc.get(accId) ?? 0,
                });
            }
            companies.sort((a, b) => b.revenuePence - a.revenuePence);
        }

        return {
            window: { fromPeriod, toPeriod, accountingMethod: method },
            summary: {
                revenuePence: base.revenuePence,
                expensesPence: base.expensesPence,
                netProfitPence: base.netProfitPence,
                netMarginPct: base.netMarginPct,
                cashAtBankPence,
                cashAsOf,
                receivablesPence,
                receiptsPence,
            },
            byBucket: base.byBucket,
            trend,
            companies,
            accounts: accountRows
                .filter((a) => a.status !== 'revoked')
                .map((a) => ({ id: a.id, companyName: a.config?.company_name ?? a.label ?? 'QuickBooks', status: a.status })),
        };
    },
};

function groupSum(rows, key) {
    const m = new Map();
    for (const r of rows) {
        const k = r.integration_account_id ?? 'unknown';
        m.set(k, (m.get(k) ?? 0) + (Number(r[key]) || 0));
    }
    return m;
}
