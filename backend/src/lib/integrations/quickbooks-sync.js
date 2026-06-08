// QuickBooks Online sync — four pulls per active org integration:
//
//   1. ProfitAndLoss report  -> monthly_financials  (source='quickbooks')
//      Backfills the last 12 months on first connect / full refresh; the nightly
//      cron refreshes the current month only (cheap, keeps the live month fresh).
//   2. BalanceSheet report   -> bank_accounts        (source='quickbooks')
//      Cash/bank balances -> the Cashflow opening balance (Sigma balance_pence).
//   3. Invoice query (Balance>0) -> invoices         (source='quickbooks')
//      Unpaid invoices = debtors -> the Debt Recovery page.
//   4. Payment query         -> payments             (source='quickbooks')
//      Customer receipts -> the Cashflow weekly receipts (settled_receipts_by_day).
//      DEDUPED against existing non-QBO settled payments (date+amount) so the same
//      income recorded in both Stripe and QBO is NOT double-counted.
//
// Xero stays a parallel accounting source — every table is keyed by `source`, so
// connecting one provider never clobbers the other's rows.
//
//   GET .../v3/company/{realmId}/reports/{ProfitAndLoss|BalanceSheet}?start_date=&end_date=&minorversion=65
//   GET .../v3/company/{realmId}/query?query=SELECT ... &minorversion=65
//     Authorization: Bearer <access_token>   Accept: application/json
//
// Access tokens expire in 1 hour, so we refresh before the call when near expiry.
//
// UAT: report JSON shapes (Rows.Row + Header.ColData / ColData / Summary) and the
// QueryResponse.{Invoice,Payment} shapes are the documented QBO v3 forms — verify
// against a live/sandbox company. The bank/cash extraction and the receipt dedupe
// (date+amount) are heuristics; confirm them on real data.

import { integrationRepository } from "../../repositories/integration.repository.js";
import { decryptSecret } from "../crypto.js";
import * as supabase_1 from "../supabase.js";

const MINOR_VERSION = '65';
const BUCKETS = ['revenue', 'staff', 'lab', 'materials', 'overhead', 'tax', 'other'];
const BACKFILL_MONTHS = 12;
const QUERY_PAGE = 1000;

function apiBase() {
    return process.env.QUICKBOOKS_API_BASE || 'https://quickbooks.api.intuit.com';
}

function toPence(amount) {
    const n = Number(String(amount ?? '').replace(/[(),]/g, (m) => (m === '(' ? '-' : '')));
    return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

// Heuristic bucket from the account name + the section it sits under. Used when
// the org hasn't mapped the account code explicitly in xero_account_map.
function heuristicBucket(accountName, sectionTitle) {
    const s = `${sectionTitle || ''} ${accountName || ''}`.toLowerCase();
    if (/income|revenue|sales|turnover/.test(s)) return 'revenue';
    if (/wage|salary|salaries|payroll|staff|associate|locum/.test(s)) return 'staff';
    if (/\blab\b|laboratory/.test(s)) return 'lab';
    if (/material|consumable|stock|supplies/.test(s)) return 'materials';
    if (/\btax\b|corporation tax|vat/.test(s)) return 'tax';
    if (/expense|overhead|rent|rates|utilit|insurance|admin|marketing/.test(s)) return 'overhead';
    return 'other';
}

function mapBucket(accountName, sectionTitle, accountMap) {
    const override = accountMap.get(String(accountName));
    if (override && BUCKETS.includes(override)) return override;
    return heuristicBucket(accountName, sectionTitle);
}

// Walk QuickBooks' nested report rows (shared by P&L and Balance Sheet). The root
// is report.Rows.Row. A SECTION row carries Header.ColData (title in cell 0) +
// nested Rows.Row + a Summary row. A LEAF row carries ColData directly: cell 0 =
// account name, the LAST cell = the amount. Summary rows are skipped (their totals
// would double-count). Returns flat [{account, amount, section}].
function parseReportRows(report) {
    const out = [];
    const walk = (rows, sectionTitle) => {
        for (const row of rows ?? []) {
            const header = row.Header?.ColData;
            const nested = row.Rows?.Row;
            if (Array.isArray(nested)) {
                const title = (Array.isArray(header) && header[0]?.value) || row.group || sectionTitle;
                walk(nested, title);
            } else if (Array.isArray(row.ColData) && row.ColData.length >= 2) {
                const account = row.ColData[0]?.value;
                const amount = row.ColData[row.ColData.length - 1]?.value;
                if (account && amount !== '' && amount != null) {
                    out.push({ account, amount, section: sectionTitle ?? '' });
                }
            }
        }
    };
    walk(report?.Rows?.Row, undefined);
    return out;
}

// Pull the cash/bank leaf accounts out of a Balance Sheet report. A leaf counts
// as cash when its account name OR its enclosing section mentions bank/cash.
function parseBalanceSheetBanks(report) {
    return parseReportRows(report)
        .filter((r) => /bank|cash/i.test(r.section) || /bank|cash/i.test(r.account))
        .map((r) => ({ account: r.account, amount: r.amount }));
}

// Last N calendar months as {period:'YYYY-MM', from:'YYYY-MM-01', to}. Index 0 is
// the current month (to = today); older months close on their last day.
function lastNMonths(n) {
    const out = [];
    const now = new Date();
    let y = now.getUTCFullYear();
    let m = now.getUTCMonth(); // 0-based
    for (let i = 0; i < n; i++) {
        const period = `${y}-${String(m + 1).padStart(2, '0')}`;
        const from = `${period}-01`;
        const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
        const to = i === 0
            ? now.toISOString().slice(0, 10)
            : `${period}-${String(lastDay).padStart(2, '0')}`;
        out.push({ period, from, to });
        m -= 1;
        if (m < 0) { m = 11; y -= 1; }
    }
    return out;
}

function mapInvoiceRow(orgId, practiceId, inv) {
    const outstanding = toPence(inv.Balance);
    return {
        organisation_id: orgId,
        practice_id: practiceId,
        contact_id: null,
        source: 'quickbooks',
        external_id: String(inv.Id),
        amount_pence: toPence(inv.TotalAmt),
        amount_outstanding_pence: outstanding,
        dated_on: inv.TxnDate ?? null,
        due_on: inv.DueDate ?? null,
        paid: outstanding <= 0,
        treatment: null,
        patient_name: inv.CustomerRef?.name ?? null,
    };
}

function mapPaymentRow(orgId, practiceId, p, date, pence) {
    return {
        organisation_id: orgId,
        practice_id: practiceId,
        source: 'quickbooks',
        external_id: String(p.Id),
        amount_pence: pence,
        currency: 'GBP',
        method: 'bank_transfer',
        status: 'settled',
        processed_at: date ? new Date(`${date}T00:00:00Z`).toISOString() : null,
        description: 'QuickBooks payment',
    };
}

// Drop QBO receipts that coincide (same day + same amount) with an already-stored
// non-QBO settled payment — the practice's QBO ledger often re-records the same
// Stripe/GoCardless income, and both feed settled_receipts_by_day. Conservative:
// only an exact date+amount match is dropped.
function dedupeReceipts(orgId, practiceId, payments, existingKeys) {
    const rows = [];
    let deduped = 0;
    for (const p of payments) {
        const date = String(p.TxnDate ?? '').slice(0, 10);
        const pence = toPence(p.TotalAmt);
        if (existingKeys.has(`${date}|${pence}`)) { deduped++; continue; }
        rows.push(mapPaymentRow(orgId, practiceId, p, date, pence));
    }
    return { rows, deduped };
}

// Shared with Xero — xero_account_map is an account-name -> bucket override table;
// an org that connects only QuickBooks simply has no rows and falls back to the
// heuristic.
async function loadAccountMap(orgId) {
    const { data } = await supabase_1.serviceClient
        .from('xero_account_map')
        .select('account_code, dental_bucket')
        .eq('organisation_id', orgId);
    const map = new Map();
    for (const r of data ?? []) map.set(String(r.account_code), r.dental_bucket);
    return map;
}

// QBO has no practice/site concept (one company per realm). Receivables + receipts
// land on the org's first practice (invoices.practice_id / payments.practice_id are
// both NOT NULL). Null when the org has no practice yet -> those pulls are skipped.
async function defaultPracticeId(orgId) {
    const { data } = await supabase_1.serviceClient
        .from('practices')
        .select('id')
        .eq('organisation_id', orgId)
        .order('created_at', { ascending: true })
        .limit(1);
    return data?.[0]?.id ?? null;
}

// date|amount keys of existing settled receipts that did NOT come from QBO, for
// the dedupe pass. Bounded to the pull window.
async function loadSettledKeys(orgId, sinceIso) {
    const { data } = await supabase_1.serviceClient
        .from('payments')
        .select('processed_at, amount_pence, status, source')
        .eq('organisation_id', orgId)
        .eq('status', 'settled')
        .neq('source', 'quickbooks')
        .gte('processed_at', sinceIso);
    const set = new Set();
    for (const r of data ?? []) {
        const date = String(r.processed_at ?? '').slice(0, 10);
        set.add(`${date}|${r.amount_pence}`);
    }
    return set;
}

async function qboReport(realmId, accessToken, name, params) {
    const qs = new URLSearchParams({ ...params, minorversion: MINOR_VERSION }).toString();
    const res = await fetch(`${apiBase()}/v3/company/${realmId}/reports/${name}?${qs}`, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`QuickBooks ${name} -> HTTP ${res.status}`);
    return res.json();
}

// Run a QBO query, following STARTPOSITION pagination until a short page returns.
async function qboQueryAll(realmId, accessToken, selectWhere, entity) {
    const out = [];
    let start = 1;
    for (let guard = 0; guard < 50; guard++) {
        const q = `${selectWhere} STARTPOSITION ${start} MAXRESULTS ${QUERY_PAGE}`;
        const res = await fetch(`${apiBase()}/v3/company/${realmId}/query?query=${encodeURIComponent(q)}&minorversion=${MINOR_VERSION}`, {
            headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
        });
        if (!res.ok) throw new Error(`QuickBooks query ${entity} -> HTTP ${res.status}`);
        const json = await res.json();
        const batch = json?.QueryResponse?.[entity] ?? [];
        out.push(...batch);
        if (batch.length < QUERY_PAGE) return out;
        start += QUERY_PAGE;
    }
    console.warn(`[quickbooks] ${entity} query hit the 50k pagination guard — results truncated`);
    return out;
}

// Ensure a fresh access token (refresh when within 60s of expiry / already expired).
async function ensureToken(orgId, integration) {
    const expiresAt = integration.expires_at ? new Date(integration.expires_at).getTime() : 0;
    if (expiresAt && expiresAt - Date.now() > 60_000) return integration;
    const { QuickBooksProvider } = await import('./quickbooks-provider.js');
    await QuickBooksProvider.refresh(orgId);
    return integrationRepository.getByProvider(orgId, 'quickbooks');
}

// 1. P&L -> monthly_financials, one period at a time. Each period is a
// delete-then-insert of this provider's rows (idempotent; never touches Xero).
async function pullProfitAndLoss(orgId, realmId, accessToken, accountMap, months) {
    let totalLines = 0;
    for (const { period, from, to } of lastNMonths(months)) {
        const report = await qboReport(realmId, accessToken, 'ProfitAndLoss', { start_date: from, end_date: to });
        const rows = parseReportRows(report).map((r) => ({
            organisation_id: orgId,
            practice_id: null,
            period,
            account_code: String(r.account),
            dental_bucket: mapBucket(r.account, r.section, accountMap),
            amount_pence: toPence(r.amount),
            source: 'quickbooks',
        }));
        const { error: delErr } = await supabase_1.serviceClient
            .from('monthly_financials')
            .delete()
            .eq('organisation_id', orgId)
            .eq('period', period)
            .eq('source', 'quickbooks');
        if (delErr) throw new Error(`monthly_financials clear: ${delErr.message}`);
        if (rows.length > 0) {
            const { error } = await supabase_1.serviceClient.from('monthly_financials').insert(rows);
            if (error) throw new Error(`monthly_financials insert: ${error.message}`);
        }
        totalLines += rows.length;
    }
    return totalLines;
}

// 2. Balance Sheet cash/bank -> bank_accounts (delete-then-insert this provider's
// rows so closed accounts drop). Point-in-time snapshot, not a window.
async function pullBalanceSheet(orgId, realmId, accessToken) {
    const report = await qboReport(realmId, accessToken, 'BalanceSheet', {});
    const rows = parseBalanceSheetBanks(report).map((b) => ({
        organisation_id: orgId,
        source: 'quickbooks',
        external_id: String(b.account),
        display_name: b.account,
        account_type: 'bank',
        balance_pence: toPence(b.amount),
        currency: 'GBP',
        last_synced_at: new Date().toISOString(),
    }));
    const { error: delErr } = await supabase_1.serviceClient
        .from('bank_accounts')
        .delete()
        .eq('organisation_id', orgId)
        .eq('source', 'quickbooks');
    if (delErr) throw new Error(`bank_accounts clear: ${delErr.message}`);
    if (rows.length > 0) {
        const { error } = await supabase_1.serviceClient.from('bank_accounts').insert(rows);
        if (error) throw new Error(`bank_accounts insert: ${error.message}`);
    }
    return { accounts: rows.length };
}

// 3. Unpaid invoices -> invoices (debtors). Delete-then-insert this provider's
// rows so an invoice paid off since the last sync disappears from Debt Recovery.
async function pullReceivables(orgId, realmId, accessToken, practiceId) {
    if (!practiceId) return { skipped: 'no_practice' };
    const invoices = await qboQueryAll(
        realmId, accessToken,
        "SELECT Id, TxnDate, DueDate, TotalAmt, Balance, CustomerRef FROM Invoice WHERE Balance > '0'",
        'Invoice',
    );
    const rows = invoices.map((inv) => mapInvoiceRow(orgId, practiceId, inv));
    const { error: delErr } = await supabase_1.serviceClient
        .from('invoices')
        .delete()
        .eq('organisation_id', orgId)
        .eq('source', 'quickbooks');
    if (delErr) throw new Error(`invoices clear: ${delErr.message}`);
    if (rows.length > 0) {
        const { error } = await supabase_1.serviceClient.from('invoices').insert(rows);
        if (error) throw new Error(`invoices insert: ${error.message}`);
    }
    return { count: rows.length };
}

// 4. Customer receipts -> payments (cashflow weekly receipts). Deduped against
// existing non-QBO settled payments, then delete-then-insert this provider's rows
// across the pull window (so re-syncs are idempotent without wiping older months).
async function pullReceipts(orgId, realmId, accessToken, practiceId, months) {
    if (!practiceId) return { skipped: 'no_practice' };
    const since = lastNMonths(months).at(-1).from; // earliest period start (YYYY-MM-01)
    const sinceIso = new Date(`${since}T00:00:00Z`).toISOString();
    const payments = await qboQueryAll(
        realmId, accessToken,
        `SELECT Id, TxnDate, TotalAmt FROM Payment WHERE TxnDate >= '${since}'`,
        'Payment',
    );
    const existingKeys = await loadSettledKeys(orgId, sinceIso);
    const { rows, deduped } = dedupeReceipts(orgId, practiceId, payments, existingKeys);
    const { error: delErr } = await supabase_1.serviceClient
        .from('payments')
        .delete()
        .eq('organisation_id', orgId)
        .eq('source', 'quickbooks')
        .gte('processed_at', sinceIso);
    if (delErr) throw new Error(`payments clear: ${delErr.message}`);
    if (rows.length > 0) {
        const { error } = await supabase_1.serviceClient.from('payments').insert(rows);
        if (error) throw new Error(`payments insert: ${error.message}`);
    }
    if (deduped) console.warn(`[quickbooks] receipts: skipped ${deduped} payment(s) matching an existing settled receipt (dedupe)`);
    return { count: rows.length, deduped };
}

async function safePull(fn, label) {
    try {
        return await fn();
    } catch (err) {
        // Secondary pulls are best-effort: a Balance Sheet / receivables / receipts
        // failure must not fail (or mark failed) the primary P&L sync.
        console.warn(`[quickbooks] ${label} pull failed: ${err.message}`);
        return { error: String(err.message).slice(0, 200) };
    }
}

export async function syncOneOrg(orgId, integrationArg, onProgress, opts = {}) {
    let integration = integrationArg ?? await integrationRepository.getByProvider(orgId, 'quickbooks');
    if (!integration?.secrets) {
        await integrationRepository.markFailed(orgId, 'quickbooks', 'no_auth: no stored credentials');
        return { error: 'no_auth' };
    }
    try {
        integration = await ensureToken(orgId, integration);
        const realmId = integration.config?.realm_id;
        if (!realmId) throw new Error('no QuickBooks company (realmId) connected');
        const { access_token } = JSON.parse(decryptSecret(integration.secrets));
        // First connect (no last_sync_at) or an explicit full refresh backfills 12
        // months of P&L; the nightly cron just refreshes the current month.
        const months = opts.months ?? ((opts.full || !integration.last_sync_at) ? BACKFILL_MONTHS : 1);
        const accountMap = await loadAccountMap(orgId);

        onProgress?.({ pct: 10, phase: 'profit_and_loss' });
        const lines = await pullProfitAndLoss(orgId, realmId, access_token, accountMap, months);

        const practiceId = await defaultPracticeId(orgId);
        onProgress?.({ pct: 55, phase: 'balance_sheet' });
        const banks = await safePull(() => pullBalanceSheet(orgId, realmId, access_token), 'balance_sheet');
        onProgress?.({ pct: 70, phase: 'receivables' });
        const receivables = await safePull(() => pullReceivables(orgId, realmId, access_token, practiceId), 'receivables');
        onProgress?.({ pct: 85, phase: 'receipts' });
        const receipts = await safePull(() => pullReceipts(orgId, realmId, access_token, practiceId, months), 'receipts');

        await integrationRepository.upsert(orgId, 'quickbooks', {
            last_sync_at: new Date().toISOString(), last_error: null, status: 'active',
        });
        return { lines, months, period: lastNMonths(1)[0].period, banks, receivables, receipts };
    } catch (err) {
        await integrationRepository.markFailed(orgId, 'quickbooks', String(err.message).slice(0, 500));
        throw err;
    }
}

export async function syncAllOrgs() {
    const { data: rows } = await supabase_1.serviceClient
        .from('integrations')
        .select('*')
        .eq('provider', 'quickbooks')
        .eq('status', 'active');
    const results = [];
    for (const row of rows ?? []) {
        try {
            const r = await syncOneOrg(row.organisation_id, row);
            results.push({ orgId: row.organisation_id, ...r });
        } catch (err) {
            results.push({ orgId: row.organisation_id, error: err.message });
        }
    }
    return results;
}

export const __test = {
    toPence, heuristicBucket, mapBucket, parseReportRows, parseBalanceSheetBanks,
    lastNMonths, mapInvoiceRow, mapPaymentRow, dedupeReceipts,
};
