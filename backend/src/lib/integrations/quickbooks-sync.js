// QuickBooks Online sync — MULTI-ACCOUNT. One org can connect N QBO companies
// (one integration_accounts row per realmId). Each company syncs independently
// and every written row is stamped with integration_account_id so the Finance QB
// dashboard can filter by company and one company's delete-then-insert never
// wipes another's rows. Four pulls per company:
//
//   1. ProfitAndLoss report  -> monthly_financials  (source='quickbooks', integration_account_id)
//      Backfills the last 12 months on first connect / full refresh; the nightly
//      cron refreshes the current month only.
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
const BACKFILL_MONTHS = 12;
const QUERY_PAGE = 1000;

function apiBase() {
    return process.env.QUICKBOOKS_API_BASE || 'https://quickbooks.api.intuit.com';
}

function toPence(amount) {
    const n = Number(String(amount ?? '').replace(/[(),]/g, (m) => (m === '(' ? '-' : '')));
    return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

// Heuristic bucket from the account name + the section it sits under.
function heuristicBucket(accountName, sectionTitle) {
    const s = `${sectionTitle || ''} ${accountName || ''}`.toLowerCase();
    if (/income|revenue|sales|turnover/.test(s)) return 'revenue';
    // Fee-earning clinician pay (the 45% "dentist/associate" benchmark line) MUST
    // be tested before the staff line — account names like "Associate salary" /
    // "Principal salary" carry "salary" and would otherwise fold into support staff.
    if (/associate|locum|principal|hygien|hygenist|therapist|self.?employed|dentist/.test(s)) return 'associates';
    if (/wage|salary|salaries|payroll|staff/.test(s)) return 'staff';
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

function parseBalanceSheetBanks(report) {
    return parseReportRows(report)
        .filter((r) => /bank|cash/i.test(r.section) || /bank|cash/i.test(r.account))
        .map((r) => ({ account: r.account, amount: r.amount }));
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

function dedupeReceipts(orgId, accountId, realmId, practiceId, payments, existingKeys) {
    const rows = [];
    let deduped = 0;
    for (const p of payments) {
        const date = String(p.TxnDate ?? '').slice(0, 10);
        const pence = toPence(p.TotalAmt);
        if (existingKeys.has(`${date}|${pence}`)) { deduped++; continue; }
        rows.push(mapPaymentRow(orgId, accountId, realmId, practiceId, p, date, pence));
    }
    return { rows, deduped };
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

// Ensure a fresh access token for THIS company (refresh when within 60s of
// expiry). Reads expires_at off the account row's config; reloads after refresh.
async function ensureAccountToken(orgId, account) {
    const expiresAt = account.config?.expires_at ? new Date(account.config.expires_at).getTime() : 0;
    if (expiresAt && expiresAt - Date.now() > 60_000) return account;
    await refreshAccountToken(orgId, account.id);
    return integrationAccountRepository.getByIdWithSecrets(orgId, account.id);
}

// 1. P&L -> monthly_financials, one period at a time. Delete-then-insert THIS
// company's rows (scoped by integration_account_id; never touches Xero or another
// QB company).
async function pullProfitAndLoss(orgId, accountId, realmId, accessToken, accountMap, months) {
    let totalLines = 0;
    for (const { period, from, to } of lastNMonths(months)) {
        const report = await qboReport(realmId, accessToken, 'ProfitAndLoss', { start_date: from, end_date: to });
        const rows = parseReportRows(report).map((r) => ({
            organisation_id: orgId,
            practice_id: null,
            integration_account_id: accountId,
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
            .eq('source', 'quickbooks')
            .eq('integration_account_id', accountId);
        if (delErr) throw new Error(`monthly_financials clear: ${delErr.message}`);
        if (rows.length > 0) {
            const { error } = await supabase_1.serviceClient.from('monthly_financials').insert(rows);
            if (error) throw new Error(`monthly_financials insert: ${error.message}`);
        }
        totalLines += rows.length;
    }
    return totalLines;
}

// 2. Balance Sheet cash/bank -> bank_accounts (delete-then-insert this company's
// rows). external_id prefixed with realmId.
async function pullBalanceSheet(orgId, accountId, realmId, accessToken) {
    const report = await qboReport(realmId, accessToken, 'BalanceSheet', {});
    const rows = parseBalanceSheetBanks(report).map((b) => ({
        organisation_id: orgId,
        integration_account_id: accountId,
        source: 'quickbooks',
        external_id: `${realmId}:${b.account}`,
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
        .eq('source', 'quickbooks')
        .eq('integration_account_id', accountId);
    if (delErr) throw new Error(`bank_accounts clear: ${delErr.message}`);
    if (rows.length > 0) {
        const { error } = await supabase_1.serviceClient.from('bank_accounts').insert(rows);
        if (error) throw new Error(`bank_accounts insert: ${error.message}`);
    }
    return { accounts: rows.length };
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

// 4. Customer receipts -> payments. Deduped against existing non-QBO settled
// payments, then delete-then-insert this company's rows across the pull window.
async function pullReceipts(orgId, accountId, realmId, accessToken, practiceId, months) {
    if (!practiceId) return { skipped: 'no_practice' };
    const since = lastNMonths(months).at(-1).from;
    const sinceIso = new Date(`${since}T00:00:00Z`).toISOString();
    const payments = await qboQueryAll(
        realmId, accessToken,
        `SELECT Id, TxnDate, TotalAmt FROM Payment WHERE TxnDate >= '${since}'`,
        'Payment',
    );
    const existingKeys = await loadSettledKeys(orgId, sinceIso);
    const { rows, deduped } = dedupeReceipts(orgId, accountId, realmId, practiceId, payments, existingKeys);
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
    if (deduped) console.warn(`[quickbooks] receipts: skipped ${deduped} payment(s) matching an existing settled receipt (dedupe)`);
    return { count: rows.length, deduped };
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
        const months = opts.months ?? ((opts.full || !account.last_sync_at) ? BACKFILL_MONTHS : 1);
        const accountMap = await loadAccountMap(orgId);

        onProgress?.({ pct: 10, phase: 'profit_and_loss' });
        const lines = await pullProfitAndLoss(orgId, accountId, realmId, access_token, accountMap, months);

        const practiceId = await defaultPracticeId(orgId);
        onProgress?.({ pct: 55, phase: 'balance_sheet' });
        const banks = await safePull(() => pullBalanceSheet(orgId, accountId, realmId, access_token), 'balance_sheet');
        onProgress?.({ pct: 70, phase: 'receivables' });
        const receivables = await safePull(() => pullReceivables(orgId, accountId, realmId, access_token, practiceId), 'receivables');
        onProgress?.({ pct: 85, phase: 'receipts' });
        const receipts = await safePull(() => pullReceipts(orgId, accountId, realmId, access_token, practiceId, months), 'receipts');

        await integrationAccountRepository.markSynced(orgId, accountId);
        return { accountId, lines, months, period: lastNMonths(1)[0].period, banks, receivables, receipts };
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
    toPence, heuristicBucket, mapBucket, parseReportRows, parseBalanceSheetBanks,
    lastNMonths, mapInvoiceRow, mapPaymentRow, dedupeReceipts,
};
