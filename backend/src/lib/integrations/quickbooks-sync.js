// QuickBooks Online sync — MULTI-ACCOUNT. One org can connect N QBO companies
// (one integration_accounts row per realmId). Each company syncs independently
// and every written row is stamped with integration_account_id so the Finance QB
// dashboard can filter by company and one company's delete-then-insert never
// wipes another's rows. Four pulls per company:
//
//   1. ProfitAndLoss report  -> monthly_financials  (source='quickbooks', integration_account_id)
//      Backfills the last 12 months on first connect / full refresh; the nightly
//      cron re-pulls the trailing 6 months (NIGHTLY_MONTHS) to catch late edits
//      and reclassified transactions. The per-period delete is scoped to each
//      month it re-inserts, so re-pulling never duplicates or orphans a period.
//   2. BalanceSheet report   -> bank_accounts        (source='quickbooks', integration_account_id)
//      Cash/bank balances -> the Cashflow opening balance.
//   3. Invoice query (Balance>0) -> invoices         (source='quickbooks', integration_account_id)
//      Unpaid invoices = debtors -> Debt Recovery.
//   4. Payment query         -> payments             (source='quickbooks', integration_account_id)
//      Customer receipts -> Cashflow weekly receipts. DEDUPED against existing
//      non-QBO settled payments (date+amount).
//
// external_id is written as '<realmId>:<entityId>' so two companies never collide
// on the (org, source, external_id) unique indexes. Xero stays a parallel source.
//
//   GET .../v3/company/{realmId}/reports/{ProfitAndLoss|BalanceSheet}?start_date=&end_date=&minorversion=65
//   GET .../v3/company/{realmId}/query?query=SELECT ... &minorversion=65
//     Authorization: Bearer <access_token>   Accept: application/json

import { integrationAccountRepository } from "../../repositories/integration-account.repository.js";
import { refreshAccountToken } from "./quickbooks-provider.js";
import { decryptSecret } from "../crypto.js";
import * as supabase_1 from "../supabase.js";

const MINOR_VERSION = '65';
const BUCKETS = ['revenue', 'associates', 'staff', 'lab', 'materials', 'overhead', 'tax', 'other'];
const BACKFILL_MONTHS = 12;   // first-fill (on-connect) window: last 12 months
const NIGHTLY_MONTHS = 6;     // nightly cron window: re-pull the trailing 6 months (catches late edits / reclassified txns)
// QuickBooks reports each P&L on a Cash or Accrual basis; we store both.
// 'accrual' is QB's default (omit the param); 'cash' adds accounting_method=Cash.
const ACCOUNTING_METHODS = ['accrual', 'cash'];
const QBO_METHOD_PARAM = { accrual: 'Accrual', cash: 'Cash' };
const QUERY_PAGE = 1000;
const REQUEST_TIMEOUT_MS = 30000; // abort a hung QuickBooks request so one stuck company can't stall the nightly cron forever

// fetch with an abort-based timeout. A hung Node fetch never rejects on its own,
// so without this a single unresponsive QBO company would block syncAllOrgs
// indefinitely (the per-org try/catch only catches thrown errors, not a hang).
async function fetchWithTimeout(url, opts) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
    try {
        return await fetch(url, { ...opts, signal: ac.signal });
    } catch (err) {
        if (err?.name === 'AbortError') {
            throw new Error(`QuickBooks request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
        }
        throw err;
    } finally {
        clearTimeout(timer);
    }
}

function apiBase() {
    return process.env.QUICKBOOKS_API_BASE || 'https://quickbooks.api.intuit.com';
}

function toPence(amount) {
    const n = Number(String(amount ?? '').replace(/[(),]/g, (m) => (m === '(' ? '-' : '')));
    return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

// Heuristic bucket from the account name + the section it sits under.
//
// CRITICAL: the QB P&L "Cost of Sales" section title contains the word "sales",
// so it must NOT be allowed to match the revenue regex — otherwise every
// Cost-of-Sales account (associate pay, lab, materials) folds into revenue and
// inflates turnover. Revenue is recognised ONLY inside an Income/Revenue section
// (which nets contra lines like patient refunds), never inside a cost/expense
// section. Cost buckets are then resolved by ACCOUNT NAME so the poisoning
// section title can't leak in.
function heuristicBucket(accountName, sectionTitle) {
    const section = String(sectionTitle || '').toLowerCase();
    const name = String(accountName || '').toLowerCase();
    const isCostSection = /cost of (sales|goods)|\bcogs\b/.test(section);
    const isExpenseSection = /expense/.test(section);

    // Revenue: only when NOT under a cost/expense section. Section-driven first
    // (everything under "Income"/"Revenue" is turnover, incl. negative refunds),
    // then a name-based fallback for income accounts with a non-standard section.
    if (!isCostSection && !isExpenseSection) {
        if (/income|revenue|turnover/.test(section)) return 'revenue';
        if (/income|revenue|\bsales\b|turnover/.test(`${section} ${name}`)) return 'revenue';
    }
    // Fee-earning clinician pay (the 45% "dentist/associate" benchmark line) MUST
    // be tested before the staff line — account names like "Associate salary" /
    // "Principal salary" carry "salary" and would otherwise fold into support staff.
    if (/associate|locum|principal|hygien|hygenist|therapist|self.?employed|dentist/.test(name)) return 'associates';
    if (/wage|salary|salaries|payroll|staff/.test(name)) return 'staff';
    if (/\blab\b|laboratory/.test(name)) return 'lab';
    if (/material|consumable|stock|supplies|implant/.test(name)) return 'materials';
    if (/\btax\b|corporation tax|vat/.test(`${section} ${name}`)) return 'tax';
    if (/expense|overhead|rent|rates|utilit|insurance|admin|marketing|advertis|bank charge|subscription|finance/.test(`${section} ${name}`)) return 'overhead';
    return 'other';
}

function mapBucket(accountName, sectionTitle, accountMap) {
    const override = accountMap.get(String(accountName));
    if (override && BUCKETS.includes(override)) return override;
    return heuristicBucket(accountName, sectionTitle);
}

// Walk QuickBooks' nested report rows (shared by P&L and Balance Sheet).
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

// Last N calendar months as {period:'YYYY-MM', from:'YYYY-MM-01', to}.
function lastNMonths(n) {
    const out = [];
    const now = new Date();
    let y = now.getUTCFullYear();
    let m = now.getUTCMonth();
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

function mapInvoiceRow(orgId, accountId, realmId, practiceId, inv) {
    const outstanding = toPence(inv.Balance);
    return {
        organisation_id: orgId,
        practice_id: practiceId,
        integration_account_id: accountId,
        contact_id: null,
        source: 'quickbooks',
        external_id: `${realmId}:${inv.Id}`,
        amount_pence: toPence(inv.TotalAmt),
        amount_outstanding_pence: outstanding,
        dated_on: inv.TxnDate ?? null,
        due_on: inv.DueDate ?? null,
        paid: outstanding <= 0,
        treatment: null,
        patient_name: inv.CustomerRef?.name ?? null,
    };
}

function mapPaymentRow(orgId, accountId, realmId, practiceId, p, date, pence) {
    return {
        organisation_id: orgId,
        practice_id: practiceId,
        integration_account_id: accountId,
        source: 'quickbooks',
        external_id: `${realmId}:${p.Id}`,
        amount_pence: pence,
        currency: 'GBP',
        method: 'bank_transfer',
        status: 'settled',
        processed_at: date ? new Date(`${date}T00:00:00Z`).toISOString() : null,
        description: 'QuickBooks payment',
    };
}

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
// NOT NULL). The real company discriminator is integration_account_id; practice is
// incidental. Null when the org has no practice yet -> those pulls are skipped.
async function defaultPracticeId(orgId) {
    const { data } = await supabase_1.serviceClient
        .from('practices')
        .select('id')
        .eq('organisation_id', orgId)
        .order('created_at', { ascending: true })
        .limit(1);
    return data?.[0]?.id ?? null;
}

async function qboReport(realmId, accessToken, name, params) {
    const qs = new URLSearchParams({ ...params, minorversion: MINOR_VERSION }).toString();
    const res = await fetchWithTimeout(`${apiBase()}/v3/company/${realmId}/reports/${name}?${qs}`, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`QuickBooks ${name} -> HTTP ${res.status}`);
    return res.json();
}

async function qboQueryAll(realmId, accessToken, selectWhere, entity) {
    const out = [];
    let start = 1;
    for (let guard = 0; guard < 50; guard++) {
        const q = `${selectWhere} STARTPOSITION ${start} MAXRESULTS ${QUERY_PAGE}`;
        const res = await fetchWithTimeout(`${apiBase()}/v3/company/${realmId}/query?query=${encodeURIComponent(q)}&minorversion=${MINOR_VERSION}`, {
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

// Ensure a fresh access token for THIS company (refresh when within 60s of
// expiry). Reads expires_at off the account row's config; reloads after refresh.
async function ensureAccountToken(orgId, account) {
    const expiresAt = account.config?.expires_at ? new Date(account.config.expires_at).getTime() : 0;
    if (expiresAt && expiresAt - Date.now() > 60_000) return account;
    await refreshAccountToken(orgId, account.id);
    return integrationAccountRepository.getByIdWithSecrets(orgId, account.id);
}

// 1. P&L -> monthly_financials, per period AND per accounting basis. Delete-then-
// insert THIS company's rows scoped by integration_account_id + accounting_method,
// so cash and accrual never clobber each other and never touch Xero/another QB co.
async function pullProfitAndLoss(orgId, accountId, realmId, accessToken, accountMap, months) {
    let totalLines = 0;
    for (const { period, from, to } of lastNMonths(months)) {
        for (const method of ACCOUNTING_METHODS) {
            const report = await qboReport(realmId, accessToken, 'ProfitAndLoss', {
                start_date: from,
                end_date: to,
                accounting_method: QBO_METHOD_PARAM[method],
            });
            const rows = parseReportRows(report).map((r) => ({
                organisation_id: orgId,
                practice_id: null,
                integration_account_id: accountId,
                period,
                account_code: String(r.account),
                dental_bucket: mapBucket(r.account, r.section, accountMap),
                amount_pence: toPence(r.amount),
                source: 'quickbooks',
                accounting_method: method,
            }));
            const { error: delErr } = await supabase_1.serviceClient
                .from('monthly_financials')
                .delete()
                .eq('organisation_id', orgId)
                .eq('period', period)
                .eq('source', 'quickbooks')
                .eq('integration_account_id', accountId)
                .eq('accounting_method', method);
            if (delErr) throw new Error(`monthly_financials clear: ${delErr.message}`);
            if (rows.length > 0) {
                const { error } = await supabase_1.serviceClient.from('monthly_financials').insert(rows);
                if (error) throw new Error(`monthly_financials insert: ${error.message}`);
            }
            totalLines += rows.length;
        }
    }
    return totalLines;
}

// 2. Cash at bank -> bank_accounts (delete-then-insert this company's rows).
// Uses the QB `Account` entity filtered to AccountType='Bank' (its CurrentBalance)
// rather than scraping the Balance Sheet report — the report grouped credit cards,
// clearing and other ledger accounts under the bank/cash sections, so the old
// scrape counted a credit card's negative balance (e.g. "Capital On Tap" -£322k)
// as cash. AccountType='Bank' is QuickBooks' own classification of real cash
// accounts (CreditCard / Other Current Asset / etc. are excluded). Overdrawn bank
// accounts keep their genuine negative balance. external_id prefixed with realmId.
// The org's real cash accounts (QB AccountType='Bank'), used both for the live
// balance and as the name->id whitelist for the month-end history pull.
async function fetchBankAccountSet(realmId, accessToken) {
    return qboQueryAll(
        realmId, accessToken,
        "SELECT Id, Name, CurrentBalance FROM Account WHERE AccountType = 'Bank' AND Active = true",
        'Account',
    );
}

async function pullBankAccounts(orgId, accountId, realmId, accessToken, bankAccounts) {
    const accounts = bankAccounts ?? (await fetchBankAccountSet(realmId, accessToken));
    const rows = accounts.map((a) => ({
        organisation_id: orgId,
        integration_account_id: accountId,
        source: 'quickbooks',
        external_id: `${realmId}:${a.Id}`,
        display_name: a.Name,
        account_type: 'bank',
        balance_pence: toPence(a.CurrentBalance),
        currency: 'GBP',
        last_synced_at: new Date().toISOString(),
    }));
    const { error: delErr } = await supabase_1.serviceClient
        .from('bank_accounts')
        .delete()
        .eq('organisation_id', orgId)
        .eq('source', 'quickbooks')
        .eq('integration_account_id', accountId);
    if (delErr) throw new Error(`bank_accounts clear: ${delErr.message}`);
    if (rows.length > 0) {
        const { error } = await supabase_1.serviceClient.from('bank_accounts').insert(rows);
        if (error) throw new Error(`bank_accounts insert: ${error.message}`);
    }
    return { accounts: rows.length };
}

// 2b. Month-end cash history -> bank_balance_snapshots. For each month in the
// window we pull a Balance Sheet AS OF that month-end and record the balance of
// each real bank account (matched by name to the AccountType='Bank' set), so the
// dashboard can show cash as-of the selected period instead of one frozen live
// figure. Delete-then-insert this company's snapshots for the pulled periods.
async function pullBankBalanceHistory(orgId, accountId, realmId, accessToken, months, bankAccounts) {
    const accounts = bankAccounts ?? (await fetchBankAccountSet(realmId, accessToken));
    if (!accounts.length) return { snapshots: 0 };
    const byName = new Map(accounts.map((a) => [String(a.Name), a]));
    const periods = lastNMonths(months);
    const rows = [];
    for (const { period, to } of periods) {
        const report = await qboReport(realmId, accessToken, 'BalanceSheet', { start_date: to, end_date: to });
        for (const r of parseReportRows(report)) {
            const acct = byName.get(String(r.account));
            if (!acct) continue; // not one of the real bank accounts
            rows.push({
                organisation_id: orgId,
                integration_account_id: accountId,
                source: 'quickbooks',
                period,
                as_of: to,
                external_id: `${realmId}:${acct.Id}`,
                display_name: acct.Name,
                balance_pence: toPence(r.amount),
                currency: 'GBP',
            });
        }
    }
    const { error: delErr } = await supabase_1.serviceClient
        .from('bank_balance_snapshots')
        .delete()
        .eq('organisation_id', orgId)
        .eq('source', 'quickbooks')
        .eq('integration_account_id', accountId)
        .in('period', periods.map((p) => p.period));
    if (delErr) throw new Error(`bank_balance_snapshots clear: ${delErr.message}`);
    if (rows.length > 0) {
        const { error } = await supabase_1.serviceClient.from('bank_balance_snapshots').insert(rows);
        if (error) throw new Error(`bank_balance_snapshots insert: ${error.message}`);
    }
    return { snapshots: rows.length };
}

// 3. Unpaid invoices -> invoices (debtors). Delete-then-insert this company's rows.
async function pullReceivables(orgId, accountId, realmId, accessToken, practiceId) {
    if (!practiceId) return { skipped: 'no_practice' };
    const invoices = await qboQueryAll(
        realmId, accessToken,
        "SELECT Id, TxnDate, DueDate, TotalAmt, Balance, CustomerRef FROM Invoice WHERE Balance > '0'",
        'Invoice',
    );
    const rows = invoices.map((inv) => mapInvoiceRow(orgId, accountId, realmId, practiceId, inv));
    const { error: delErr } = await supabase_1.serviceClient
        .from('invoices')
        .delete()
        .eq('organisation_id', orgId)
        .eq('source', 'quickbooks')
        .eq('integration_account_id', accountId);
    if (delErr) throw new Error(`invoices clear: ${delErr.message}`);
    if (rows.length > 0) {
        const { error } = await supabase_1.serviceClient.from('invoices').insert(rows);
        if (error) throw new Error(`invoices insert: ${error.message}`);
    }
    return { count: rows.length };
}

// 4. Customer receipts -> payments. Stores THIS company's own QuickBooks receipts
// (source='quickbooks', integration_account_id) so the QuickBooks panel shows real
// numbers. Delete-then-insert this company's rows across the pull window. NOTE:
// we deliberately do NOT dedupe against other sources (e.g. Dentally) at write
// time — QB receipts and the clinical PMS often record the SAME patient cash, but
// suppressing them here left the source-isolated QB panel permanently at £0. The
// same-cash double-count is avoided at the GROUP cash roll-up READ layer instead
// (Dentally is the primary receipts feed; QB is excluded there — see
// analytics.repository settled_receipts). Idempotency comes from the delete below.
async function pullReceipts(orgId, accountId, realmId, accessToken, practiceId, months) {
    if (!practiceId) return { skipped: 'no_practice' };
    const since = lastNMonths(months).at(-1).from;
    const sinceIso = new Date(`${since}T00:00:00Z`).toISOString();
    const payments = await qboQueryAll(
        realmId, accessToken,
        `SELECT Id, TxnDate, TotalAmt FROM Payment WHERE TxnDate >= '${since}'`,
        'Payment',
    );
    const rows = payments.map((p) => mapPaymentRow(
        orgId, accountId, realmId, practiceId, p, String(p.TxnDate ?? '').slice(0, 10), toPence(p.TotalAmt),
    ));
    const { error: delErr } = await supabase_1.serviceClient
        .from('payments')
        .delete()
        .eq('organisation_id', orgId)
        .eq('source', 'quickbooks')
        .eq('integration_account_id', accountId)
        .gte('processed_at', sinceIso);
    if (delErr) throw new Error(`payments clear: ${delErr.message}`);
    if (rows.length > 0) {
        const { error } = await supabase_1.serviceClient.from('payments').insert(rows);
        if (error) throw new Error(`payments insert: ${error.message}`);
    }
    return { count: rows.length };
}

async function safePull(fn, label) {
    try {
        return await fn();
    } catch (err) {
        console.warn(`[quickbooks] ${label} pull failed: ${err.message}`);
        return { error: String(err.message).slice(0, 200) };
    }
}

// Sync ONE QuickBooks company (integration_accounts row).
export async function syncAccount(orgId, accountId, onProgress = () => {}, opts = {}) {
    let account = await integrationAccountRepository.getByIdWithSecrets(orgId, accountId);
    if (!account?.secrets) {
        await integrationAccountRepository.markFailed(orgId, accountId, 'no_auth: no stored credentials');
        return { error: 'no_auth' };
    }
    try {
        account = await ensureAccountToken(orgId, account);
        const realmId = account.config?.realm_id;
        if (!realmId) throw new Error('no QuickBooks company (realmId) on account');
        const { access_token } = JSON.parse(decryptSecret(account.secrets));
        const months = opts.months ?? ((opts.full || !account.last_sync_at) ? BACKFILL_MONTHS : NIGHTLY_MONTHS);
        const accountMap = await loadAccountMap(orgId);

        onProgress?.({ pct: 10, phase: 'profit_and_loss' });
        const lines = await pullProfitAndLoss(orgId, accountId, realmId, access_token, accountMap, months);

        const practiceId = await defaultPracticeId(orgId);
        onProgress?.({ pct: 55, phase: 'balance_sheet' });
        // Fetch the real bank-account set once; reuse for the live balance + the
        // month-end history (avoids a duplicate Account query).
        const bankAccounts = await safePull(() => fetchBankAccountSet(realmId, access_token), 'bank_account_set');
        const bankSet = Array.isArray(bankAccounts) ? bankAccounts : [];
        const banks = await safePull(() => pullBankAccounts(orgId, accountId, realmId, access_token, bankSet), 'bank_accounts');
        const bankHistory = await safePull(() => pullBankBalanceHistory(orgId, accountId, realmId, access_token, months, bankSet), 'bank_balance_history');
        onProgress?.({ pct: 70, phase: 'receivables' });
        const receivables = await safePull(() => pullReceivables(orgId, accountId, realmId, access_token, practiceId), 'receivables');
        onProgress?.({ pct: 85, phase: 'receipts' });
        const receipts = await safePull(() => pullReceipts(orgId, accountId, realmId, access_token, practiceId, months), 'receipts');

        await integrationAccountRepository.markSynced(orgId, accountId);
        return { accountId, lines, months, period: lastNMonths(1)[0].period, banks, bankHistory, receivables, receipts };
    } catch (err) {
        await integrationAccountRepository.markFailed(orgId, accountId, String(err.message).slice(0, 500));
        throw err;
    }
}

// Sync ALL of an org's active QuickBooks companies. Coarse aggregate progress
// (each company advances the bar by its share). Used by the integration.service
// syncNow path (via the syncOneOrg compatibility wrapper) and the worker.
export async function syncAllAccounts(orgId, onProgress = () => {}, opts = {}) {
    const accounts = (await integrationAccountRepository.list(orgId, 'quickbooks'))
        .filter((a) => a.status === 'active');
    const results = [];
    const n = accounts.length || 1;
    let done = 0;
    for (const a of accounts) {
        try {
            const r = await syncAccount(orgId, a.id, (p) => {
                const base = Math.round((done / n) * 100);
                onProgress?.({ ...p, pct: base + Math.round((p.pct ?? 0) / n) });
            }, opts);
            results.push(r);
        } catch (err) {
            results.push({ accountId: a.id, error: err.message });
        }
        done += 1;
        onProgress?.({ pct: Math.round((done / n) * 100), phase: 'company_done' });
    }
    return { accounts: accounts.length, results };
}

// Compatibility wrapper for integration.service's ON_DEMAND_SYNCERS map (which
// calls syncer(orgId, integrationRow, onProgress, opts)). The marker integrations
// row is ignored — the real work fans out over the company account rows.
export async function syncOneOrg(orgId, _integrationArg, onProgress = () => {}, opts = {}) {
    return syncAllAccounts(orgId, onProgress, opts);
}

// Worker entry: every org with >=1 active QuickBooks company.
export async function syncAllOrgs() {
    const { data: rows } = await supabase_1.serviceClient
        .from('integration_accounts')
        .select('organisation_id')
        .eq('provider', 'quickbooks')
        .eq('status', 'active');
    const orgIds = [...new Set((rows ?? []).map((r) => r.organisation_id))];
    const results = [];
    for (const orgId of orgIds) {
        try { results.push({ orgId, ...(await syncAllAccounts(orgId)) }); }
        catch (err) { results.push({ orgId, error: err.message }); }
    }
    return results;
}

export const __test = {
    toPence, heuristicBucket, mapBucket, parseReportRows,
    lastNMonths, mapInvoiceRow, mapPaymentRow, ACCOUNTING_METHODS,
};
