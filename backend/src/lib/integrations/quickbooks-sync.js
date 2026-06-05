// QuickBooks Online sync — pulls the Profit & Loss report per active org
// integration, maps each account line to a dental_bucket, and upserts into
// monthly_financials so the Finance / Valuation / Corporation Tax screens read
// real actuals. Xero remains a parallel source (rows keyed by `source`).
//
//   GET https://quickbooks.api.intuit.com/v3/company/{realmId}/reports/ProfitAndLoss
//         ?start_date=&end_date=&minorversion=65
//     Authorization: Bearer <access_token>
//     Accept: application/json
//   -> walk report.Rows.Row (nested Sections with Header/Rows/Summary) -> {account, amount}
//   -> bucket via xero_account_map (per-org override, shared) else a name heuristic
//   -> replace this period's quickbooks rows in monthly_financials
//
// Access tokens expire in 1 hour, so we refresh before the call when near expiry.
//
// NOTE: only the P&L is pulled (mirrors the Xero connector). Balance-sheet /
// cashflow-report / class (location) allocation are follow-ups. Verify the
// report JSON against a live company during UAT — QuickBooks nests rows under
// Rows.Row with Header.ColData (section), ColData (leaf), and Summary rows.

import { integrationRepository } from "../../repositories/integration.repository.js";
import { decryptSecret } from "../crypto.js";
import * as supabase_1 from "../supabase.js";

const MINOR_VERSION = '65';
const BUCKETS = ['revenue', 'staff', 'lab', 'materials', 'overhead', 'tax', 'other'];

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

// Walk QuickBooks' nested report rows. The report root is report.Rows.Row.
// A SECTION row carries Header.ColData (title in cell 0) + nested Rows.Row +
// a Summary row. A LEAF row carries ColData directly: cell 0 = account name,
// the LAST cell = the period amount. Summary rows are skipped (their totals
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

function currentPeriod() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function monthBounds() {
    const d = new Date();
    const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    const to = d.toISOString().slice(0, 10);
    return { from, to };
}

// Shared with Xero — xero_account_map is just an account-code -> bucket override
// table; an org that connects only QuickBooks simply has no rows and falls back
// to the heuristic.
async function loadAccountMap(orgId) {
    const { data } = await supabase_1.serviceClient
        .from('xero_account_map')
        .select('account_code, dental_bucket')
        .eq('organisation_id', orgId);
    const map = new Map();
    for (const r of data ?? []) map.set(String(r.account_code), r.dental_bucket);
    return map;
}

// Ensure a fresh access token (refresh when within 60s of expiry / already expired).
async function ensureToken(orgId, integration) {
    const expiresAt = integration.expires_at ? new Date(integration.expires_at).getTime() : 0;
    if (expiresAt && expiresAt - Date.now() > 60_000) return integration;
    const { QuickBooksProvider } = await import('./quickbooks-provider.js');
    await QuickBooksProvider.refresh(orgId);
    return integrationRepository.getByProvider(orgId, 'quickbooks');
}

export async function syncOneOrg(orgId, integrationArg) {
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
        const { from, to } = monthBounds();

        const url = `${apiBase()}/v3/company/${realmId}/reports/ProfitAndLoss`
            + `?start_date=${from}&end_date=${to}&minorversion=${MINOR_VERSION}`;
        const res = await fetch(url, {
            headers: {
                Authorization: `Bearer ${access_token}`,
                Accept: 'application/json',
            },
        });
        if (!res.ok) throw new Error(`QuickBooks P&L -> HTTP ${res.status}`);
        const report = await res.json();

        const accountMap = await loadAccountMap(orgId);
        const period = currentPeriod();
        const rows = parseReportRows(report).map((r) => ({
            organisation_id: orgId,
            practice_id: null,
            period,
            account_code: String(r.account),
            dental_bucket: mapBucket(r.account, r.section, accountMap),
            amount_pence: toPence(r.amount),
            source: 'quickbooks',
        }));

        // A P&L sync replaces the whole month: delete this period's quickbooks
        // rows then insert fresh. Idempotent, and avoids depending on the
        // COALESCE functional unique index as an ON CONFLICT arbiter (which
        // Supabase upsert can't target). Filtered on source so Xero rows for the
        // same period are never clobbered.
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
        await integrationRepository.upsert(orgId, 'quickbooks', {
            last_sync_at: new Date().toISOString(), last_error: null, status: 'active',
        });
        return { lines: rows.length, period };
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

export const __test = { toPence, heuristicBucket, mapBucket, parseReportRows };
